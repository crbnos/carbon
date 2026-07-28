import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  actionTaskEntities,
  actionTaskParentId,
  actionTaskPermissions,
  isActionTaskEntityType
} from "@carbon/ee/action-task-entity";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  linkActionToJiraIssue,
  tiptapToAdf,
  unlinkActionFromJiraIssue
} from "@carbon/ee/jira.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { requireChangeNoticeEditable } from "~/modules/items/items.server";
import { getActionTaskWithParent } from "~/services/action-task.server";

const jira = getJiraClient();
const logger = getLogger("erp", "jira", "issue-link");

export const action: ActionFunction = async ({ request }) => {
  try {
    const form = await request.formData();

    const actionId = form.get("actionId") as string;
    const entityType = form.get("entityType") as string | null;

    if (!actionId) {
      return { success: false, message: "Missing required fields: actionId" };
    }

    if (!isActionTaskEntityType(entityType)) {
      return { success: false, message: "Invalid entityType" };
    }

    const { companyId, client } = await requirePermissions(
      request,
      actionTaskPermissions(entityType)
    );

    if (entityType === "changeOrderActionTask") {
      const task = await getActionTaskWithParent(
        client,
        entityType,
        actionId,
        companyId
      );

      const locked = task.parentId
        ? await requireChangeNoticeEditable(client, {
            changeNoticeId: task.parentId,
            companyId,
            scope: "workflow"
          })
        : { error: { message: "Could not find change notice" } };

      if (locked) {
        return { success: false, message: locked.error.message };
      }
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
          getActionTaskWithParent(client, entityType, actionId, companyId),
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
          entityType,
          actionId,
          issue,
          siteUrl,
          assignee: assigneeId
        });

        if (!linked || linked.data?.length === 0) {
          return { success: false, message: "Failed to link issue" };
        }

        const parentId = actionTaskParentId(linked.data, entityType) ?? "";

        const url =
          getAppUrl() +
          `${actionTaskEntities[entityType].detailPath(parentId)}/details`;

        // Update the Jira issue description with the task's notes
        const notes = carbonIssue.notes;
        if (notes && typeof notes === "object") {
          try {
            const adfDescription = tiptapToAdf(notes as any);
            await jira.updateIssue(companyId, issue.id, {
              description: adfDescription
            });
          } catch (e) {
            logger.error("Failed to update Jira issue description", {
              error: e
            });
          }
        }

        // Create a remote link in Jira pointing back to Carbon
        await jira.createRemoteLink(
          companyId,
          issue.id,
          url,
          `Linked Carbon Issue: ${carbonIssue.parentReadableId ?? ""}`
        );

        return { success: true, message: "Linked successfully" };
      }

      case "DELETE": {
        const mapping = await getJiraIssueFromExternalId(
          client,
          companyId,
          actionId,
          entityType
        );

        // Unlink from Carbon's DB first
        const unlinked = await unlinkActionFromJiraIssue(client, companyId, {
          entityType,
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
            logger.error("Failed to clean up Jira remote link", { error: e });
          }
        }

        return { success: true, message: "Unlinked successfully" };
      }
    }
  } catch (error) {
    logger.error("Jira issue link action error", { error });
    return data(
      { success: false, message: `Failed to process request` },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);

  const entityType = url.searchParams.get("entityType");

  if (!isActionTaskEntityType(entityType)) {
    return { issues: [] };
  }

  const { companyId } = await requirePermissions(
    request,
    actionTaskPermissions(entityType)
  );

  const query = url.searchParams.get("search") as string;

  if (!query || query.trim().length === 0) {
    return { issues: [] };
  }

  const issues = await jira.searchIssues(companyId, query);

  return { issues };
};
