import { runTriggerSchema } from "@carbon/workflows";
import { z } from "zod";
import { getJobDatabaseClient } from "../../../db";
import {
  type EngineStep,
  executeWorkflowRun,
  failCrashedRun
} from "../../../workflows/engine";
import { inngest } from "../../client";

const runPayloadSchema = z.object({
  runId: z.string(),
  companyId: z.string(),
  workflowId: z.string(),
  workflowVersionId: z.string(),
  eventId: z.string(),
  ownerId: z.string(),
  sourceEventId: z.string(),
  trigger: runTriggerSchema
});

/** Walks one matched run's graph, one durable step per node, acting as the
 * workflow's owner. */
export const workflowRunFunction = inngest.createFunction(
  {
    id: "workflow-run",
    retries: 3,
    idempotency: "event.data.runId",
    concurrency: [
      { limit: 5, key: "event.data.companyId" },
      { limit: 5, key: "event.data.workflowId" }
    ],
    onFailure: async ({ event, logger }) => {
      const { runId, companyId } = event.data.event.data;
      logger.error(`Workflow run ${runId} failed`, event.data.error);

      await failCrashedRun(
        getJobDatabaseClient(),
        runId,
        companyId,
        event.data.error.message
      );
    }
  },
  { event: "carbon/workflow-run.queued" },
  async ({ event, step, logger }) => {
    const payload = runPayloadSchema.parse(event.data);
    // Inngest types step.run as Jsonify<T>; every engine step already returns plain JSON.
    return executeWorkflowRun({
      payload,
      step: step as unknown as EngineStep,
      logger
    });
  }
);
