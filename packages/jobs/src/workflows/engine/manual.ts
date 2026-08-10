import { datetime } from "@carbon/utils";
import {
  createWorkflowCatalog,
  type RunTrigger,
  type WorkflowDefinition
} from "@carbon/workflows";
import { nanoid } from "nanoid";
import { getJobDatabaseClient } from "../../db";
import type { EngineLogger, EngineStep, RunPayload } from "./execute";
import { createDatabaseLedger, walkWorkflow } from "./execute";
import { failCrashedRun } from "./log";

export type ManualRunResult = {
  /** The `workflowRun` row this test wrote. The caller reads its steps back from it. */
  runId: string;
  status: "Succeeded" | "Failed";
  /** Why the run failed, when it failed before any step could say so. */
  error: string | null;
};

/**
 * A test run from the builder: the same walk, the same real side effects, and — since
 * those side effects are real — the same run history, flagged `isTest`.
 */
export async function executeManualWorkflowRun(params: {
  definition: WorkflowDefinition;
  companyId: string;
  companyGroupId: string;
  ownerId: string;
  workflowId: string;
  workflowVersionId: string;
  eventId: string;
  triggerNodeId: string;
  trigger: RunTrigger;
  logger: EngineLogger;
}): Promise<ManualRunResult> {
  const db = getJobDatabaseClient();
  const startedAt = datetime.timestamp();
  const trigger = params.trigger;

  const run = await db
    .insertInto("workflowRun")
    .values({
      companyId: params.companyId,
      workflowId: params.workflowId,
      workflowVersionId: params.workflowVersionId,
      eventId: params.eventId,
      // The prefix is what makes a test run recognisable from its source alone.
      sourceEventId: `manual:${nanoid()}`,
      triggerTable: trigger.kind === "record" ? trigger.table : null,
      triggerRecordId: trigger.kind === "record" ? trigger.recordId : null,
      ownerId: params.ownerId,
      status: "Running",
      isTest: true,
      startedAt
    })
    .returning(["id", "sourceEventId"])
    .executeTakeFirstOrThrow();

  // A real run id, so the `workflow_run_id` JWT claim on every write points at a row
  // the matcher can read: a workflow this test triggers is chained and loop-guarded
  // exactly as it would be in production.
  const payload: RunPayload = {
    runId: run.id,
    companyId: params.companyId,
    workflowId: params.workflowId,
    workflowVersionId: params.workflowVersionId,
    eventId: params.eventId,
    ownerId: params.ownerId,
    sourceEventId: run.sourceEventId,
    trigger: params.trigger
  };

  try {
    const result = await walkWorkflow({
      payload,
      definition: params.definition,
      companyGroupId: params.companyGroupId,
      startedAt,
      // No durability to buy, so every step id collapses to a direct call.
      step: { run: (_id, handler) => handler() } satisfies EngineStep,
      ledger: createDatabaseLedger(db, {
        runId: run.id,
        companyId: params.companyId
      }),
      catalog: createWorkflowCatalog(),
      logger: params.logger,
      triggerNodeId: params.triggerNodeId
    });

    return { runId: run.id, status: result.status, error: result.error };
  } catch (err) {
    // The row exists from here on, so a throw that escapes the walk would leave it
    // Running until the nightly reaper. The durable path gets this from Inngest's
    // failure hook; a manual run has no such hook.
    await failCrashedRun(
      db,
      run.id,
      params.companyId,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
}
