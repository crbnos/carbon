import { requirePermissions } from "@carbon/auth/auth.server";
import type { TiptapDocument } from "@carbon/ee/jira";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  tiptapToAdf
} from "@carbon/ee/jira";
import type { ActionFunction } from "react-router";
import { data } from "react-router";

const jira = getJiraClient();

export const action: ActionFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});

  if (request.method !== "POST") {
    return data({ success: false, message: "Method not allowed" }, 405);
  }

  const form = await request.formData();
  const actionId = form.get("actionId") as string;
  const notesStr = form.get("notes") as string;

  if (!actionId) {
    return data({ success: false, message: "Missing actionId" }, 400);
  }

  // Parse the notes JSON
  let notes: TiptapDocument | null = null;
  try {
    notes = notesStr ? JSON.parse(notesStr) : null;
  } catch {
    return data({ success: false, message: "Invalid notes format" }, 400);
  }

  // Get the linked Jira issue
  const issue = await getJiraIssueFromExternalId(client, companyId, actionId);

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
    console.error("Failed to sync notes to Jira:", error);
    return data(
      { success: false, message: "Failed to sync notes to Jira" },
      500
    );
  }
};
