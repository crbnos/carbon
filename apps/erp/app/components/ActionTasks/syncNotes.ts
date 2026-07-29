import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { path } from "~/utils/path";

const logger = getLogger("erp", "action-task-notes-sync");

type NotesSyncTarget = "Linear" | "Jira";

const endpoints: Record<NotesSyncTarget, string> = {
  Linear: path.to.api.linearSyncNotes,
  Jira: path.to.api.jiraSyncNotes
};

/**
 * Best-effort push of an action task's notes to a linked Linear/Jira issue.
 * The note is already persisted separately, so a failure is only logged — it
 * never throws, toasts, or reverts the save.
 */
export async function syncActionTaskNotes(
  target: NotesSyncTarget,
  {
    actionId,
    entityType,
    notes
  }: {
    actionId: string;
    entityType: ActionTaskEntityType;
    notes: JSONContent;
  }
) {
  try {
    const response = await fetch(endpoints[target], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        actionId,
        entityType,
        notes: JSON.stringify(notes)
      })
    });

    // fetch only rejects on network errors, so an HTTP or `success: false`
    // response has to be checked explicitly or the failure is invisible.
    const result = response.ok
      ? ((await response.json()) as { success?: boolean; message?: string })
      : null;

    if (!result?.success) {
      logger.error(`Failed to sync notes to ${target}`, {
        actionId,
        entityType,
        status: response.status,
        message: result?.message
      });
    }
  } catch (e) {
    logger.error(`Failed to sync notes to ${target}`, {
      actionId,
      entityType,
      error: e
    });
  }
}
