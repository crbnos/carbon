import type { Events } from "./events.ts";
import { inngest } from "./inngest/client.ts";

/**
 * Map trigger.dev task IDs → inngest event names.
 * This allows callers to migrate from `tasks.trigger("notify", payload)`
 * to `trigger("notify", payload)` with minimal changes.
 */
const taskToEvent = {
  "accounting-backfill": "carbon/accounting-backfill",
  "company-export": "carbon/company-export",
  "company-import": "carbon/company-import",
  "company-restore": "carbon/company-restore",
  "company-restore-finalize": "carbon/company-restore-finalize",
  "company-restore-revert": "carbon/company-restore-revert",
  "model-thumbnail": "carbon/model-thumbnail",
  notify: "carbon/notify",
  onboard: "carbon/onboard",
  "paperless-parts": "carbon/paperless-parts",
  "post-transactions": "carbon/post-transaction",
  "print-job-deliver": "carbon/print-job-deliver",
  "print-job": "carbon/print-job",
  recalculate: "carbon/recalculate",
  "schedule-job": "carbon/reschedule-job",
  "send-email": "carbon/send-email",
  "send-slack": "carbon/send-slack",
  "slack-document-assignment-update": "carbon/slack-document-assignment-update",
  "slack-document-created": "carbon/slack-document-created",
  "slack-document-status-update": "carbon/slack-document-status-update",
  "slack-document-task-update": "carbon/slack-document-task-update",
  "sync-external-accounting": "carbon/sync-external-accounting",
  "sync-issue-from-jira": "carbon/jira-sync",
  "sync-issue-from-linear": "carbon/linear-sync",
  "update-permissions": "carbon/update-permissions",
  "user-admin": "carbon/user-admin"
} as const;

type TaskMap = typeof taskToEvent;

type TaskPayloads = {
  [K in keyof TaskMap]: TaskMap[K] extends keyof Events
    ? Events[TaskMap[K]]["data"]
    : never;
};

/**
 * Typed trigger helper — drop-in replacement for `tasks.trigger(taskId, payload)`.
 *
 * @example
 * ```ts
 * import { trigger } from "@carbon/jobs";
 * await trigger("notify", { event, companyId, documentId, recipient });
 * ```
 */
export async function trigger<T extends keyof TaskPayloads>(
  taskId: T,
  payload: TaskPayloads[T]
) {
  const eventName = taskToEvent[taskId];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return inngest.send({ data: payload, name: eventName } as any);
}

/**
 * Typed batch trigger helper — drop-in replacement for `tasks.batchTrigger(taskId, items)`.
 *
 * @example
 * ```ts
 * import { batchTrigger } from "@carbon/jobs";
 * await batchTrigger("recalculate", items.map(i => ({ payload: i })));
 * ```
 */
export async function batchTrigger<T extends keyof TaskPayloads>(
  taskId: T,
  items: Array<{ payload: TaskPayloads[T] }>
) {
  const eventName = taskToEvent[taskId];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return inngest.send(
    items.map((i) => ({ data: i.payload, name: eventName })) as any
  );
}
