import { getUser } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TiptapDocument } from "../../jira/lib/richtext";
import {
  getJiraClient,
  getJiraIssueFromExternalId,
  mapCarbonStatusToJiraCategory,
  tiptapToAdf
} from "../../jira/lib";
import type { NotificationEvent, NotificationService } from "../types";

const jira = getJiraClient();

/**
 * Jira Notification Service
 * Updates Jira issues based on Carbon notification events
 */
export class JiraNotificationService implements NotificationService {
  id = "jira";
  name = "Jira";

  async send(
    event: NotificationEvent,
    context: { serviceRole: SupabaseClient<Database> }
  ): Promise<void> {
    switch (event.type) {
      case "task.status.changed": {
        if (!["action", "investigation"].includes(event.data.type)) return;

        const issue = await getJiraIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return;

        const targetCategory = mapCarbonStatusToJiraCategory(event.data.status);

        await jira.transitionIssue(event.companyId, issue.id, targetCategory);

        break;
      }

      case "task.assigned": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const issue = await getJiraIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return; // No linked Jira issue

        const { data: user } = await getUser(
          context.serviceRole,
          event.data.assignee
        );

        if (!user) return; // No assignee user

        // Find the Jira user by email
        const jiraUser = await jira.findUserByEmail(
          event.companyId,
          user.email
        );

        if (!jiraUser) return;

        await jira.updateIssue(event.companyId, issue.id, {
          assigneeId: jiraUser.accountId
        });
        break;
      }

      case "task.notes.changed": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const issue = await getJiraIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return; // No linked Jira issue

        // Convert Tiptap notes to ADF for Jira
        const notes = event.data.notes as TiptapDocument | null | undefined;
        if (!notes) return;

        try {
          const description = tiptapToAdf(notes);

          await jira.updateIssue(event.companyId, issue.id, {
            description
          });
        } catch (e) {
          console.error("Failed to sync notes to Jira:", e);
        }
        break;
      }
    }
    return;
  }
}
