import {
  createEventCatalog,
  executorFor,
  type NodeResult,
  type RunTrigger,
  type RuntimeValue,
  readWorkflowVersion,
  type WorkflowCatalog,
  type WorkflowNode
} from "@carbon/workflows";
import { NonRetriableError } from "inngest";
import { getJobDatabaseClient } from "../../db";
import { claimStep, failInterruptedSteps, settleStep } from "./ledger";
import { createEntityLoader, type EntityCache, triggerOutputs } from "./loader";
import { claimRun, finishRun, loadRunContext } from "./log";
import {
  getOwnerClient,
  hasPermission,
  type OwnerPermissions,
  readOwnerPermissions
} from "./owner";
import {
  advance,
  alreadyExecuted,
  createWalkState,
  findTriggerNode,
  MAX_NODE_EXECUTIONS,
  nextNode
} from "./walk";

export interface RunPayload {
  runId: string;
  companyId: string;
  workflowId: string;
  workflowVersionId: string;
  eventId: string;
  ownerId: string;
  sourceEventId: string;
  trigger: RunTrigger;
}

/** Only what the engine uses, so it never depends on Inngest's generics. */
export interface EngineStep {
  run<T>(id: string, handler: () => Promise<T>): Promise<T>;
}

export interface EngineLogger {
  info(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

const SWITCHED_OFF = "This workflow was switched off before the run started.";
const NO_PERMISSIONS =
  "The permissions for the owner of this workflow could not be read.";
const NOT_AVAILABLE = "This kind of step is not available yet.";
const TOO_MANY_STEPS = "This workflow ran too many steps.";

function noAccess(module: string): string {
  const area = module.charAt(0).toUpperCase() + module.slice(1);
  return `The owner of this workflow no longer has access to ${area}.`;
}

interface StepOutcome {
  status: NodeResult["status"];
  handle: string | null;
  outputs: Record<string, RuntimeValue> | null;
}

interface NodeArgs {
  payload: RunPayload;
  node: WorkflowNode;
  sequence: number;
  outputs: Record<string, Record<string, RuntimeValue>>;
  permissions: OwnerPermissions;
  catalog: WorkflowCatalog;
  cache: EntityCache;
}

/**
 * The permission gate and the work come from the same registry entry, so a node
 * kind can never gain an executor without also gaining its permission check.
 */
async function runExecutor(args: NodeArgs): Promise<NodeResult> {
  const { payload, node, catalog, cache } = args;

  const executor = executorFor(node);
  if (executor === undefined) return { status: "Failed", error: NOT_AVAILABLE };

  const module = executor.permission(node, catalog);
  if (
    module !== undefined &&
    !hasPermission(args.permissions, module, "view", payload.companyId)
  ) {
    return { status: "Failed", error: noAccess(module) };
  }

  // A fresh five-minute connection per step, always tagged with the run.
  const client = await getOwnerClient(payload.ownerId, payload.runId);
  return executor.execute(node, {
    catalog,
    loader: createEntityLoader({ client, companyId: payload.companyId, cache }),
    outputs: args.outputs
  });
}

async function runOneNode(args: NodeArgs): Promise<StepOutcome> {
  const { payload, node } = args;
  const db = getJobDatabaseClient();
  const startedAt = new Date().toISOString();

  // Claim before acting: at most once, on purpose. An interrupted step is
  // settled as Failed at the end of the run rather than silently retried.
  const claim = await claimStep(db, {
    runId: payload.runId,
    companyId: payload.companyId,
    nodeId: node.id,
    nodeType: node.type,
    itemKey: "",
    sequence: args.sequence
  });

  if (!claim.claimed) {
    return { status: "Skipped", handle: null, outputs: null };
  }

  const result = await runExecutor(args);

  await settleStep(db, {
    stepRunId: claim.stepRunId,
    companyId: payload.companyId,
    status: result.status,
    statusReason:
      result.status === "Skipped"
        ? result.reason
        : result.status === "Succeeded"
          ? (result.summary ?? null)
          : null,
    error: result.status === "Failed" ? result.error : null,
    output: result.status === "Succeeded" ? result.outputs : null,
    branchTaken:
      result.status === "Succeeded" ? (result.branchTaken ?? null) : null,
    startedAt
  });

  return {
    status: result.status,
    handle: result.status === "Skipped" ? null : (result.handle ?? null),
    outputs: result.status === "Succeeded" ? result.outputs : null
  };
}

export async function executeWorkflowRun(params: {
  payload: RunPayload;
  step: EngineStep;
  logger: EngineLogger;
}): Promise<{ runId: string; status: string; steps: number }> {
  const { payload, step, logger } = params;
  const catalog = createEventCatalog();

  const loaded = await step.run("load", async () => {
    const db = getJobDatabaseClient();
    const context = await loadRunContext(db, payload.runId, payload.companyId);
    if (context === null) {
      throw new NonRetriableError("Workflow run not found");
    }

    const startedAt = new Date().toISOString();

    if (!context.workflowActive) {
      await finishRun(db, {
        runId: payload.runId,
        companyId: payload.companyId,
        status: "Skipped",
        statusReason: SWITCHED_OFF,
        startedAt
      });
      return { settled: "Skipped" as const };
    }

    const read = readWorkflowVersion(context.version);
    if (!read.ok) {
      await finishRun(db, {
        runId: payload.runId,
        companyId: payload.companyId,
        status: "Failed",
        error: read.message,
        startedAt
      });
      return { settled: "Failed" as const };
    }

    // The atomic double-delivery guard: only a Queued row flips to Running.
    if (!(await claimRun(db, payload.runId, payload.companyId))) {
      return { settled: "Duplicate" as const };
    }

    return { settled: null, definition: read.definition, startedAt };
  });

  if (loaded.settled !== null) {
    return { runId: payload.runId, status: loaded.settled, steps: 0 };
  }

  const { definition, startedAt } = loaded;

  const granted = await step.run("permissions", async () => {
    const refuse = async (error: string) => {
      await finishRun(getJobDatabaseClient(), {
        runId: payload.runId,
        companyId: payload.companyId,
        status: "Failed",
        error,
        startedAt
      });
      return { ok: false as const };
    };

    const client = await getOwnerClient(payload.ownerId, payload.runId);
    const permissions = await readOwnerPermissions(
      client,
      payload.ownerId,
      payload.companyId
    );
    if (permissions === null) return refuse(NO_PERMISSIONS);

    // Checked explicitly as well as by RLS: a lost permission has to produce a
    // message the customer can act on, not zero rows and a silent skip.
    const module = catalog.getEvent(payload.eventId)?.permission;
    if (
      module !== undefined &&
      !hasPermission(permissions, module, "view", payload.companyId)
    ) {
      return refuse(noAccess(module));
    }

    return { ok: true as const, permissions };
  });

  if (!granted.ok) {
    return { runId: payload.runId, status: "Failed", steps: 0 };
  }

  const cache: EntityCache = new Map();
  const outputs: Record<string, Record<string, RuntimeValue>> = {};
  const trigger = findTriggerNode(definition);
  if (trigger !== undefined) {
    outputs[trigger.id] = triggerOutputs({
      eventId: payload.eventId,
      trigger: payload.trigger,
      catalog,
      cache
    });
  }

  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const state = createWalkState(definition);
  let executions = 0;
  let failed = false;
  let capped = false;

  for (
    let nodeId = nextNode(state);
    nodeId !== undefined;
    nodeId = nextNode(state)
  ) {
    // A node reached from two branches runs once; its one step row is the record.
    if (alreadyExecuted(state, nodeId)) continue;

    const node = byId.get(nodeId);
    if (node === undefined) continue;

    if (executions >= MAX_NODE_EXECUTIONS) {
      capped = true;
      break;
    }

    const outcome = await step.run(`node:${nodeId}`, () =>
      runOneNode({
        payload,
        node,
        sequence: state.sequence,
        outputs,
        permissions: granted.permissions,
        catalog,
        cache
      })
    );

    executions += 1;
    if (outcome.status === "Failed") failed = true;
    if (outcome.outputs !== null) outputs[nodeId] = outcome.outputs;
    advance(state, definition, nodeId, outcome.handle);
  }

  const status = await step.run("finish", async () => {
    const db = getJobDatabaseClient();
    const interrupted = await failInterruptedSteps(
      db,
      payload.runId,
      payload.companyId
    );
    const settled =
      failed || capped || interrupted > 0
        ? ("Failed" as const)
        : ("Succeeded" as const);

    await finishRun(db, {
      runId: payload.runId,
      companyId: payload.companyId,
      status: settled,
      error: capped ? TOO_MANY_STEPS : null,
      startedAt
    });
    return settled;
  });

  logger.info(
    `Workflow run ${payload.runId} ${status.toLowerCase()} after ${executions} steps`
  );

  return { runId: payload.runId, status, steps: executions };
}
