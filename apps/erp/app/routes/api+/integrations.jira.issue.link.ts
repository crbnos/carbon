import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  linkActionToJiraIssue,
  tiptapToAdf,
  unlinkActionFromJiraIssue
} from "@carbon/ee/jira";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { getIssueAction } from "~/modules/quality/quality.service";

const jira = getJiraClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const { companyId, client } = await requirePermissions(request, {});
    const form = await request.formData();

    const actionId = form.get("actionId") as string;

    if (!actionId) {
      return { success: false, message: "Missing required fields: actionId" };
    }

    switch (request.method) {
      case "POST": {
        const issueId = form.get("issueId") as string;

        if (!issueId) {
          return {
            success: false,
            message: "Missing required fields: issueId"
          };
        }

        const [carbonIssue, issue, siteUrl] = await Promise.all([
          getIssueAction(client, actionId),
          jira.getIssue(companyId, issueId),
          jira.getSiteUrl(companyId)
        ]);

        if (!issue) {
          return { success: false, message: "Issue not found" };
        }

        const email = issue.fields.assignee?.emailAddress ?? "";

        let assigneeId: string | null = null;
        if (email) {
          const assignee = await client
            .from("user")
            .select("id")
            .eq("email", email)
            .single();
          assigneeId = assignee.data?.id ?? null;
        }

        const linked = await linkActionToJiraIssue(client, companyId, {
          actionId,
          issue,
          siteUrl,
          assignee: assigneeId
        });

        if (!linked || linked.data?.length === 0) {
          return { success: false, message: "Failed to link issue" };
        }

        const nonConformanceId = linked.data?.[0].nonConformanceId;

        const url = getAppUrl() + `/x/issue/${nonConformanceId}/details`;

        // Update the Jira issue description with the task's notes
        const notes = carbonIssue.data?.notes;
        if (notes && typeof notes === "object") {
          try {
            const adfDescription = tiptapToAdf(notes as any);
            await jira.updateIssue(companyId, issue.id, {
              description: adfDescription
            });
          } catch (e) {
            console.error("Failed to update Jira issue description:", e);
          }
        }

        // Create a remote link in Jira pointing back to Carbon
        await jira.createRemoteLink(
          companyId,
          issue.id,
          url,
          `Linked Carbon Issue: ${
            carbonIssue.data?.nonConformance?.nonConformanceId ?? ""
          }`
        );

        return { success: true, message: "Linked successfully" };
      }

      case "DELETE": {
        const mapping = await getJiraIssueFromExternalId(
          client,
          companyId,
          actionId
        );

        // Unlink from Carbon's DB first
        const unlinked = await unlinkActionFromJiraIssue(client, companyId, {
          actionId
        });

        if (unlinked.error) {
          return { success: false, message: "Failed to unlink issue" };
        }

        // Best-effort: clean up remote link in Jira
        if (mapping) {
          try {
            const remoteLinks = await jira.getRemoteLinks(
              companyId,
              mapping.id
            );
            const carbonLink = remoteLinks.find(
              (link) =>
                link.application?.name === "Carbon" ||
                link.globalId.startsWith("carbon-")
            );
            if (carbonLink) {
              await jira.deleteRemoteLink(
                companyId,
                mapping.id,
                carbonLink.globalId
              );
            }
          } catch (e) {
            console.error("Failed to clean up Jira remote link:", e);
          }
        }

        return { success: true, message: "Unlinked successfully" };
      }
    }
  } catch (error) {
    console.error("Jira issue link action error:", error);
    return data(
      { success: false, message: `Failed to process request` },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const { companyId } = await requirePermissions(request, {});
  const url = new URL(request.url);

  const query = url.searchParams.get("search") as string;

  if (!query || query.trim().length === 0) {
    return { issues: [] };
  }

  const issues = await jira.searchIssues(companyId, query);

  return { issues };
};
