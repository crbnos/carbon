import { EventSchema } from "@carbon/database/event";
import { z } from "zod";
import { getJobDatabaseClient } from "../../../db";
import { computeEventIds } from "../../../workflows/event-ids";
import { matchAndQueue } from "../../../workflows/matcher";
import { inngest } from "../../client";

const workflowPayloadSchema = z.object({
  // pgmq msg_id is BIGINT — node-pg hands it back as a string, so coerce
  // rather than assume the number the QueueJob type claims.
  msgId: z.coerce.number(),
  companyId: z.string(),
  actorId: z.string().nullish(),
  workflowRunId: z.string().nullish(),
  data: EventSchema
});

export type WorkflowPayload = z.infer<typeof workflowPayloadSchema>;

/**
 * Record-change entry point of the workflow matcher: one pgmq announcement ->
 * catalog event ids -> subscribed workflows -> one Queued workflowRun (and
 * one carbon/workflow-run.queued event) per workflow. Blocked firings are
 * written as Blocked runs and not queued.
 */
export const workflowFunction = inngest.createFunction(
  {
    id: "event-handler-workflow",
    retries: 3,
    idempotency: "event.data.msgId",
    concurrency: {
      limit: 10,
      key: "event.data.companyId"
    }
  },
  { event: "carbon/event-workflow" },
  async ({ event, step }) => {
    const payload = workflowPayloadSchema.parse(event.data);
    if (payload.data.operation === "TRUNCATE") {
      return { queued: 0, blocked: 0 };
    }

    const eventIds = computeEventIds({
      table: payload.data.table,
      operation: payload.data.operation,
      old: payload.data.old,
      new: payload.data.new
    });
    if (eventIds.length === 0) {
      return { queued: 0, blocked: 0 };
    }

    const { operation } = payload.data;
    const result = await step.run("match", async () => {
      const db = getJobDatabaseClient();
      return matchAndQueue(db, {
        companyId: payload.companyId,
        workflowRunId: payload.workflowRunId ?? null,
        sourceEventId: `pgmq:${payload.msgId}`,
        eventIds,
        trigger: {
          kind: "record",
          table: payload.data.table,
          recordId: payload.data.recordId,
          operation,
          record: payload.data.new ?? payload.data.old,
          before: operation === "UPDATE" ? payload.data.old : null,
          after: operation === "UPDATE" ? payload.data.new : null
        },
        triggerTable: payload.data.table,
        triggerRecordId: payload.data.recordId
      });
    });

    if (result.events.length > 0) {
      await step.sendEvent("queue-runs", result.events);
    }
    return { queued: result.queued, blocked: result.blocked };
  }
);
