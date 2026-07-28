import { requirePermissions } from "@carbon/auth/auth.server";
import {
  actionTaskPermissions,
  isActionTaskEntityType
} from "@carbon/ee/action-task-entity";
import type { TiptapDocument } from "@carbon/ee/jira.server";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  tiptapToAdf
} from "@carbon/ee/jira.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunction } from "react-router";
import { data } from "react-router";
import { requireChangeNoticeEditable } from "~/modules/items/items.server";
import { getActionTaskWithParent } from "~/services/action-task.server";

const logger = getLogger("erp", "integrations-jira-issue-sync-notes");

const jira = getJiraClient();

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== "POST") {
    return data({ success: false, message: "Method not allowed" }, 405);
  }

  const form = await request.formData();
  const actionId = form.get("actionId") as string;
  const entityType = form.get("entityType") as string | null;
  const notesStr = form.get("notes") as string;

  if (!actionId) {
    return data({ success: false, message: "Missing actionId" }, 400);
  }

  if (!isActionTaskEntityType(entityType)) {
    return data({ success: false, message: "Invalid entityType" }, 400);
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
      return data({ success: false, message: locked.error.message }, 400);
    }
  }

  // Parse the notes JSON
  let notes: TiptapDocument | null = null;
  try {
    notes = notesStr ? JSON.parse(notesStr) : null;
  } catch {
    return data({ success: false, message: "Invalid notes format" }, 400);
  }

  // Get the linked Jira issue
  const issue = await getJiraIssueFromExternalId(
    client,
    companyId,
    actionId,
    entityType
  );

  if (!issue) {
    return { success: true, message: "No linked Jira issue" };
  }

  if (!notes) {
    return { success: true, message: "No notes to sync" };
  }

  try {
    // Convert Tiptap notes to ADF for Jira
    const description = tiptapToAdf(notes);

    await jira.updateIssue(companyId, issue.id, {
      description
    });

    return { success: true, message: "Notes synced to Jira" };
  } catch (error) {
    logger.error("Failed to sync notes to Jira", { error: error });
    return data(
      { success: false, message: "Failed to sync notes to Jira" },
      500
    );
  }
};
