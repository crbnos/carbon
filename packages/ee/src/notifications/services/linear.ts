import { getUser } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TiptapDocument } from "../../linear/lib/index.server";
import {
  getLinearClient,
  getLinearIssueFromExternalId,
  mapCarbonStatusToLinearStatus,
  tiptapToMarkdown
} from "../../linear/lib/index.server";
import type { NotificationEvent, NotificationService } from "../types";

const linear = getLinearClient();
const logger = getLogger("ee", "notifications", "linear");

/**
 * Linear Notification Service
 * Updates Linear issues based on Carbon notification events
 */
export class LinearNotificationService implements NotificationService {
  id = "linear";
  name = "Linear";

  async send(
    event: NotificationEvent,
    context: { serviceRole: SupabaseClient<Database> }
  ): Promise<void> {
    switch (event.type) {
      case "task.status.changed": {
        if (
          !event.data.type ||
          !["action", "investigation"].includes(event.data.type)
        )
          return;

        const issue = await getLinearIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return;

        const state = await linear.getWorkflowState(
          event.companyId,
          mapCarbonStatusToLinearStatus(event.data.status!)
        );

        if (!state) return;

        await linear.updateIssue(event.companyId, {
          id: issue.id,
          stateId: state.id
        });

        break;
      }

      case "task.assigned": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const issue = await getLinearIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return; // No linked Linear issue

        const { data: user } = await getUser(
          context.serviceRole,
          event.data.assignee
        );

        if (!user) return; // No assignee user

        const [linearUser] = await linear.getUsers(event.companyId, {
          email: user.email
        });

        if (!linearUser) return;

        await linear.updateIssue(event.companyId, {
          id: issue.id,
          assigneeId: linearUser.id
        });
        break;
      }

      case "task.notes.changed": {
        if (event.data.table !== "nonConformanceActionTask") return;

        const issue = await getLinearIssueFromExternalId(
          context.serviceRole,
          event.companyId,
          event.data.id
        );

        if (!issue) return; // No linked Linear issue

        // Convert Tiptap notes to markdown for Linear
        const notes = event.data.notes as TiptapDocument | null | undefined;
        if (!notes) return;

        try {
          const description = tiptapToMarkdown(notes);

          await linear.updateIssue(event.companyId, {
            id: issue.id,
            description
          });
        } catch (e) {
          logger.error("Failed to sync notes to Linear", { error: e });
        }
        break;
      }
    }
    return;
  }
}
