import { WORKFLOW_EVENTS } from "@carbon/workflows";
import { z } from "zod";
import { getJobDatabaseClient } from "../../../db";
import { matchAndQueue } from "../../../workflows/matcher";
import { inngest } from "../../client";

const momentPayloadSchema = z.object({
  momentId: z.string(),
  moment: z.string(),
  companyId: z.string(),
  actorId: z.string().nullable(),
  outputs: z.record(z.object({ id: z.string() }).passthrough())
});

/**
 * Moment entry point of the workflow matcher. A moment already IS a catalog
 * event id; a moment is always Person-origin for the filter (no workflow run
 * tag travels with it — a workflow action cannot raise one in this phase).
 */
export const workflowMomentFunction = inngest.createFunction(
  {
    id: "workflow-moment",
    retries: 3,
    idempotency: "event.data.momentId",
    concurrency: {
      limit: 10,
      key: "event.data.companyId"
    }
  },
  { event: "carbon/workflow-moment.raised" },
  async ({ event, step, logger }) => {
    const payload = momentPayloadSchema.parse(event.data);

    const match = WORKFLOW_EVENTS[payload.moment]?.match;
    if (!match || !("moment" in match)) {
      logger.warn(`Unknown workflow moment: ${payload.moment}`);
      return { queued: 0, blocked: 0 };
    }

    const result = await step.run("match", async () => {
      const db = getJobDatabaseClient();
      return matchAndQueue(db, {
        companyId: payload.companyId,
        workflowRunId: null,
        sourceEventId: `moment:${payload.momentId}`,
        eventIds: [payload.moment],
        trigger: {
          kind: "moment",
          moment: payload.moment,
          outputs: payload.outputs
        },
        triggerTable: null,
        triggerRecordId: null
      });
    });

    if (result.events.length > 0) {
      await step.sendEvent("queue-runs", result.events);
    }
    return { queued: result.queued, blocked: result.blocked };
  }
);
