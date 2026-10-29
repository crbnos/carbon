// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { runTriggerSchema } from "@carbon/ee/workflows";
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
    onFailure: async ({ event, logger }) => {
      const { runId, companyId } = event.data.event.data;
      logger.error("Workflow run {runId} failed", {
        runId,
        error: event.data.error
      });

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
