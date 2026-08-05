import {
  createWorkflowCatalog,
  type RunTrigger,
  type WorkflowDefinition
} from "@carbon/workflows";
import { nanoid } from "nanoid";
import type { EngineLogger, EngineStep, RunPayload } from "./execute";
import { walkWorkflow } from "./execute";
import { createMemoryLedger, type StepRecord } from "./ledger";

export type ManualRunResult = {
  status: "Succeeded" | "Failed";
  steps: StepRecord[];
  /** Why the run failed, when it failed before any step could say so. */
  error: string | null;
};

/** A test run from the builder: the same walk, the same real side effects, but the
 * ledger is in memory so nothing lands in `workflowRun` / `workflowStepRun`. */
export async function executeManualWorkflowRun(params: {
  definition: WorkflowDefinition;
  companyId: string;
  companyGroupId: string;
  ownerId: string;
  workflowId: string;
  eventId: string;
  triggerNodeId: string;
  trigger: RunTrigger;
  logger: EngineLogger;
}): Promise<ManualRunResult> {
  // The prefix is load-bearing: it becomes the `workflow_run_id` JWT claim, so a test
  // run's writes are tagged automation-origin and a stray tag is recognisable.
  const runId = `manual:${nanoid()}`;
  const ledger = createMemoryLedger();

  // No durability to buy, so every step id collapses to a direct call.
  const step: EngineStep = { run: (_id, handler) => handler() };

  const payload: RunPayload = {
    runId,
    companyId: params.companyId,
    workflowId: params.workflowId,
    workflowVersionId: "",
    eventId: params.eventId,
    ownerId: params.ownerId,
    sourceEventId: runId,
    trigger: params.trigger
  };

  const result = await walkWorkflow({
    payload,
    definition: params.definition,
    companyGroupId: params.companyGroupId,
    startedAt: new Date().toISOString(),
    step,
    ledger,
    catalog: createWorkflowCatalog(),
    logger: params.logger,
    triggerNodeId: params.triggerNodeId
  });

  return {
    status: result.status,
    error: result.error,
    steps: ledger.records()
  };
}
