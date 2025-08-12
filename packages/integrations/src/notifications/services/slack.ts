import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createIssueSlackThread,
  syncIssueAssignmentToSlack,
  syncIssueStatusToSlack,
  syncIssueTaskToSlack,
} from "../../slack/lib/service";
import type { NotificationEvent, NotificationService } from "../types";

export class SlackNotificationService implements NotificationService {
  id = "slack";
  name = "Slack";

  async send(
    event: NotificationEvent,
    context: { serviceRole: SupabaseClient<Database> }
  ): Promise<void> {
    switch (event.type) {
      case "issue.created":
        await createIssueSlackThread(context.serviceRole, {
          carbonUrl: event.carbonUrl,
          companyId: event.companyId,
          description: event.data.description,
          id: event.data.id,
          nonConformanceId: event.data.nonConformanceId,
          severity: event.data.severity,
          title: event.data.title,
          userId: event.userId,
        });
        break;

      case "issue.status.changed":
        await syncIssueStatusToSlack(context.serviceRole, {
          companyId: event.companyId,
          nonConformanceId: event.data.nonConformanceId,
          newStatus: event.data.status,
          previousStatus: "", // We'll need to get this from the event data if needed
          userId: event.userId,
        });
        break;

      case "task.status.changed":
        await syncIssueTaskToSlack(context.serviceRole, {
          companyId: event.companyId,
          id: event.data.id,
          status: event.data.status,
          // @ts-expect-error - it's cool
          taskType: event.data.type,
          userId: event.userId,
        });
        break;

      case "task.assigned":
        await syncIssueAssignmentToSlack(context.serviceRole, {
          nonConformanceId: event.data.id,
          companyId: event.companyId,
          userId: event.userId,
          newAssignee: event.data.assignee,
        });
        break;

      default:
        // Unknown event type, skip
        break;
    }
  }
}
