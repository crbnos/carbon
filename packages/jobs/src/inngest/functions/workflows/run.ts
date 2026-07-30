import { runTriggerSchema } from "@carbon/workflows";
import { z } from "zod";
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

/**
 * Stub consumer for matched runs. Phase 4 replaces this body with the graph
 * walker and adds the per-company / per-workflow concurrency keys.
 */
export const workflowRunFunction = inngest.createFunction(
  { id: "workflow-run", retries: 3 },
  { event: "carbon/workflow-run.queued" },
  async ({ event, step, logger }) => {
    const payload = runPayloadSchema.parse(event.data);
    await step.run("stub", async () => {
      logger.info(
        `Workflow run ${payload.runId} queued for workflow ${payload.workflowId} (stub — the engine is phase 4)`
      );
    });
    return { runId: payload.runId };
  }
);
