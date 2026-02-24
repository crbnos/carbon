import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getLinearClient,
  linkActionToLinearIssue,
  unlinkActionFromLinearIssue
} from "@carbon/ee/linear";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { getIssueAction } from "~/modules/quality/quality.service";

const linear = getLinearClient();

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

        const [carbonIssue, issue] = await Promise.all([
          getIssueAction(client, actionId),
          linear.getIssueById(companyId, issueId)
        ]);

        if (!issue) {
          return { success: false, message: "Issue not found" };
        }

        const email = issue.assignee?.email ?? "";

        const assignee = await client
          .from("user")
          .select("id")
          .eq("email", email)
          .single();

        const linked = await linkActionToLinearIssue(client, companyId, {
          actionId,
          issue,
          assignee: assignee.data ? assignee.data.id : null
        });

        if (!linked || linked.data?.length === 0) {
          return { success: false, message: "Failed to link issue" };
        }

        const nonConformanceId = linked.data?.[0].nonConformanceId;

        const url = getAppUrl() + `/x/issue/${nonConformanceId}/details`;

        await linear.createAttachmentLink(companyId, {
          issueId: issue.id as string,
          url,
          title: `Linked Carbon Issue: ${
            carbonIssue.data?.nonConformance?.nonConformanceId ?? ""
          }`
        });

        return { success: true, message: "Linked successfully" };
      }

      case "DELETE": {
        // Unlink from Carbon's DB first
        const unlinked = await unlinkActionFromLinearIssue(client, companyId, {
          actionId
        });

        if (unlinked.error) {
          return { success: false, message: "Failed to unlink issue" };
        }

        // Best-effort: clean up attachment in Linear
        try {
          const { data: action } = await getIssueAction(client, actionId);

          if (action?.nonConformanceId) {
            const [found] = await linear.listAttachments(
              companyId,
              action.nonConformanceId
            );

            if (found) {
              await linear.removeAttachment(companyId, found.id);
            }
          }
        } catch (e) {
          console.error("Failed to clean up Linear attachment:", e);
        }

        return { success: true, message: "Unlinked successfully" };
      }
    }
  } catch (error) {
    console.error("Linear issue link action error:", error);
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

  const issues = await linear.listIssues(companyId, query);

  return { issues };
};
