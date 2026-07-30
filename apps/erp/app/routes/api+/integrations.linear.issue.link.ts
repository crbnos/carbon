import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  actionTaskEntities,
  actionTaskParentId,
  actionTaskPermissions,
  isActionTaskEntityType
} from "@carbon/ee/action-task-entity";
import {
  getLinearClient,
  linkActionToLinearIssue,
  unlinkActionFromLinearIssue
} from "@carbon/ee/linear.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { requireChangeNoticeEditable } from "~/modules/items/items.server";
import { getActionTaskWithParent } from "~/services/action-task.server";

const logger = getLogger("erp", "integrations-linear-issue-link");

const linear = getLinearClient();

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

        const [carbonIssue, issue] = await Promise.all([
          getActionTaskWithParent(client, entityType, actionId, companyId),
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
          entityType,
          actionId,
          issue,
          assignee: assignee.data ? assignee.data.id : null
        });

        if (!linked || linked.data?.length === 0) {
          return { success: false, message: "Failed to link issue" };
        }

        const parentId = actionTaskParentId(linked.data, entityType) ?? "";

        const url =
          getAppUrl() +
          `${actionTaskEntities[entityType].detailPath(parentId)}/details`;

        await linear.createAttachmentLink(companyId, {
          issueId: issue.id as string,
          url,
          title: `Linked Carbon Issue: ${carbonIssue.parentReadableId ?? ""}`
        });

        return { success: true, message: "Linked successfully" };
      }

      case "DELETE": {
        // Unlink from Carbon's DB first
        const unlinked = await unlinkActionFromLinearIssue(client, companyId, {
          entityType,
          actionId
        });

        if (unlinked.error) {
          return { success: false, message: "Failed to unlink issue" };
        }

        // Best-effort: clean up attachment in Linear
        try {
          const parentId = actionTaskParentId(unlinked.data, entityType);

          if (parentId) {
            const [found] = await linear.listAttachments(companyId, parentId);

            if (found) {
              await linear.removeAttachment(companyId, found.id);
            }
          }
        } catch (e) {
          logger.error("Failed to clean up Linear attachment", { error: e });
        }

        return { success: true, message: "Unlinked successfully" };
      }
    }
  } catch (error) {
    logger.error("Linear issue link action error", { error: error });
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

  const issues = await linear.listIssues(companyId, query);

  return { issues };
};
