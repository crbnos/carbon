import { datetime } from "@carbon/utils";
import {
  batchCandidates,
  createWorkflowCatalog,
  executorFor,
  FAILURE_HANDLE,
  itemKeyFor,
  listValue,
  type NodeResult,
  planBatch,
  type RunTrigger,
  type RuntimeContext,
  type RuntimeValue,
  readWorkflowVersion,
  resolveValue,
  SUCCESS_HANDLE,
  type WorkflowCatalog,
  type WorkflowDefinition,
  type WorkflowNode
} from "@carbon/workflows";
import { NonRetriableError } from "inngest";
import { getJobDatabaseClient, type JobDatabase } from "../../db";
import { createWorkflowServices } from "../actions";
import {
  claimStep,
  failInterruptedSteps,
  type RunLedger,
  settleStep
} from "./ledger";
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
  findTriggerNodeForEvent,
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
const NOTHING_TO_RUN = "That list was empty, so there was nothing to do.";

const BATCH_CONCURRENCY = 5;

/** The one wording for a lost permission. Exported because the builder's test-run
 * route gates on the same permission before the walk, and two copies would drift. */
export function noAccess(module: string): string {
  const area = module.charAt(0).toUpperCase() + module.slice(1);
  return `The owner of this workflow no longer has access to ${area}.`;
}

/** The durable ledger: the two run-log tables, with the run's scope folded in. Lives
 * here rather than in `ledger.ts` so that module keeps exporting only free functions. */
export function createDatabaseLedger(
  db: JobDatabase,
  scope: { runId: string; companyId: string }
): RunLedger {
  return {
    claimStep: (input) => claimStep(db, { ...input, ...scope }),
    settleStep: (input) =>
      settleStep(db, { ...input, companyId: scope.companyId }),
    failInterruptedSteps: () =>
      failInterruptedSteps(db, scope.runId, scope.companyId),
    finishRun: (input) => finishRun(db, { ...input, ...scope })
  };
}

interface StepOutcome {
  status: NodeResult["status"];
  handle: string | null;
  outputs: Record<string, RuntimeValue> | null;
  /** Items that failed inside a batch whose node still succeeded. */
  failedItems?: number;
}

interface NodeArgs {
  payload: RunPayload;
  ledger: RunLedger;
  node: WorkflowNode;
  sequence: number;
  outputs: Record<string, Record<string, RuntimeValue>>;
  permissions: OwnerPermissions;
  catalog: WorkflowCatalog;
  cache: EntityCache;
  companyGroupId: string;
  /** The item a batched node is on; unset outside a batch. */
  item?: RuntimeValue;
  record?: (key: string, value: RuntimeValue) => void;
}

// A fresh five-minute connection per step, always tagged with the run.
async function contextFor(args: NodeArgs): Promise<RuntimeContext> {
  const { payload, catalog, cache } = args;
  const client = await getOwnerClient(payload.ownerId, payload.runId);

  return {
    catalog,
    loader: createEntityLoader({ client, companyId: payload.companyId, cache }),
    outputs: args.outputs,
    ...(args.item === undefined ? {} : { item: args.item }),
    ...(args.record === undefined ? {} : { record: args.record }),
    services: createWorkflowServices({
      client,
      catalog,
      companyId: payload.companyId,
      companyGroupId: args.companyGroupId,
      ownerId: payload.ownerId,
      runId: payload.runId,
      workflowId: payload.workflowId
    })
  };
}

// The permission gate and the work come from the same registry entry, so they cannot drift.
async function runExecutor(args: NodeArgs): Promise<NodeResult> {
  const { payload, node, catalog } = args;

  const executor = executorFor(node);
  if (executor === undefined) return { status: "Failed", error: NOT_AVAILABLE };

  const required = executor.permission(node, catalog);
  if (
    required !== undefined &&
    !hasPermission(
      args.permissions,
      required.module,
      required.action,
      payload.companyId
    )
  ) {
    return { status: "Failed", error: noAccess(required.module) };
  }

  return executor.execute(node, await contextFor(args));
}

/** What is durable at claim time: the configuration this turn ran with, plus its
 * item. The values it resolves are merged in later by `settleStep`. */
function stepInput(args: NodeArgs): unknown {
  const data = args.node.data as { inputs?: unknown };
  const input: Record<string, unknown> = {};
  if (data.inputs !== undefined) input.inputs = data.inputs;
  if (args.item !== undefined) input.item = args.item;
  return Object.keys(input).length === 0 ? undefined : input;
}

async function recordStep(
  args: NodeArgs,
  itemKey: string,
  produce: (
    record: (key: string, value: RuntimeValue) => void
  ) => Promise<NodeResult>
): Promise<StepOutcome> {
  const { node, ledger } = args;
  const startedAt = datetime.timestamp();

  // Claim before acting: at most once, on purpose. An interrupted step settles
  // as Failed at the end of the run rather than silently retrying.
  const claim = await ledger.claimStep({
    nodeId: node.id,
    nodeType: node.type,
    itemKey,
    sequence: args.sequence,
    input: stepInput(args)
  });

  if (!claim.claimed) {
    return { status: "Skipped", handle: null, outputs: null };
  }

  // Filled in as values resolve, so a step that throws still reports what it used.
  const resolved: Record<string, RuntimeValue> = {};
  const result = await produce((key, value) => {
    resolved[key] = value;
  });

  await ledger.settleStep({
    stepRunId: claim.stepRunId,
    status: result.status,
    statusReason:
      result.status === "Skipped"
        ? result.reason
        : result.status === "Succeeded"
          ? (result.summary ?? null)
          : null,
    error: result.status === "Failed" ? result.error : null,
    output: result.status === "Succeeded" ? result.outputs : null,
    input:
      Object.keys(resolved).length === 0
        ? undefined
        : { ...((stepInput(args) as object | undefined) ?? {}), resolved },
    detail: result.status === "Failed" ? undefined : result.detail,
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

type BatchPlan = { items: RuntimeValue[]; dropped: number } | { skip: string };

/** `undefined` for a node that runs once. Otherwise the one list it works through —
 * the same wiring rule the validator reads, so the two cannot pick different lists. */
async function resolveBatchItems(
  args: NodeArgs
): Promise<BatchPlan | undefined> {
  const { node } = args;
  if (node.type !== "action") return undefined;
  const action = args.catalog.getAction(node.data.action);
  if (action === undefined) return undefined;

  const candidates = batchCandidates(action, node.data.inputs);
  if (candidates.length === 0) return undefined;

  const ctx = await contextFor(args);
  for (const name of candidates) {
    const value = node.data.inputs[name];
    if (value === undefined) continue;
    const resolved = await resolveValue(value, ctx);
    if (!resolved.ok) return { skip: resolved.reason };
    if (resolved.value.kind === "list") return planBatch(resolved.value);
  }

  // Nothing turned out to be a list, so there is nothing to repeat: run once.
  return undefined;
}

function batchSummary(ran: number, dropped: number, failed: number): string {
  const parts = [`Ran ${ran} of ${ran + dropped}`];
  if (dropped > 0) parts.push(`${dropped} were not used`);
  if (failed > 0) parts.push(`${failed} failed`);
  return `${parts.join("; ")}.`;
}

/** One durable step per item, then one aggregated outcome for the walk. */
async function runBatchedNode(
  step: EngineStep,
  args: NodeArgs,
  plan: BatchPlan
): Promise<StepOutcome> {
  const { node } = args;

  if ("skip" in plan || plan.items.length === 0) {
    const reason = "skip" in plan ? plan.skip : NOTHING_TO_RUN;
    return step.run(`node:${node.id}`, () =>
      recordStep(args, "", async () => ({ status: "Skipped", reason }))
    );
  }

  // Items are independent, so they go in groups rather than one at a time. Bounded,
  // not unbounded: the run-log pool is small, and a 100-item batch fired at once is
  // the same pool exhaustion the retention job had to be rewritten to avoid.
  const results: StepOutcome[] = [];
  for (let i = 0; i < plan.items.length; i += BATCH_CONCURRENCY) {
    const group = plan.items.slice(i, i + BATCH_CONCURRENCY);
    // Order is load-bearing: the node's outputs are defined to be in item order.
    results.push(
      ...(await Promise.all(
        group.map((item) => {
          const itemKey = itemKeyFor(item);
          return step.run(`node:${node.id}:${itemKey}`, () =>
            recordStep({ ...args, item }, itemKey, (record) =>
              runExecutor({ ...args, item, record })
            )
          );
        })
      ))
    );
  }

  const succeeded = results.filter((one) => one.status === "Succeeded");
  const failed = results.filter((one) => one.status === "Failed").length;
  const summary = batchSummary(results.length, plan.dropped, failed);

  // The action's first declared output is what the rest of the graph reads.
  const action =
    node.type === "action"
      ? args.catalog.getAction(node.data.action)
      : undefined;
  const [name, type] = Object.entries(action?.outputs ?? {})[0] ?? [];
  const outputs =
    name === undefined || type === undefined || type.kind === "list"
      ? {}
      : {
          [name]: listValue(
            type,
            succeeded.flatMap((one) => {
              const value = one.outputs?.[name];
              return value === undefined ? [] : [value];
            })
          ).value
        };

  // One more row for the whole node: it is where a dropped or failed item is
  // visible, and its handle is what the walk follows.
  const aggregate: NodeResult =
    succeeded.length === 0
      ? { status: "Failed", error: summary, handle: FAILURE_HANDLE }
      : { status: "Succeeded", outputs, handle: SUCCESS_HANDLE, summary };

  const outcome = await step.run(`node:${node.id}`, () =>
    recordStep(args, "", async () => aggregate)
  );

  // A failed item does not stop the graph, but it must not leave the run green.
  return { ...outcome, failedItems: failed };
}

export async function executeWorkflowRun(params: {
  payload: RunPayload;
  step: EngineStep;
  logger: EngineLogger;
}): Promise<{ runId: string; status: string; steps: number }> {
  const { payload, step, logger } = params;
  const catalog = createWorkflowCatalog();

  const loaded = await step.run("load", async () => {
    const db = getJobDatabaseClient();
    const context = await loadRunContext(db, payload.runId, payload.companyId);
    if (context === null) {
      throw new NonRetriableError("Workflow run not found");
    }

    const startedAt = datetime.timestamp();

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

    return {
      settled: null,
      definition: read.definition,
      startedAt,
      // Read once per run: every create action needs it, no node can change it.
      companyGroupId: context.companyGroupId
    };
  });

  if (loaded.settled !== null) {
    return { runId: payload.runId, status: loaded.settled, steps: 0 };
  }

  const { definition, startedAt, companyGroupId } = loaded;

  const ledger = createDatabaseLedger(getJobDatabaseClient(), {
    runId: payload.runId,
    companyId: payload.companyId
  });

  const walked = await walkWorkflow({
    payload,
    definition,
    companyGroupId,
    startedAt,
    step,
    ledger,
    catalog,
    logger
  });

  return { runId: payload.runId, status: walked.status, steps: walked.steps };
}

/** Everything after the run row exists: the permission gate, the trigger's own step,
 * the walk and the finish. The ledger decides whether any of it is durable, so why a
 * run failed comes back here rather than only through `finishRun`. */
export async function walkWorkflow(params: {
  payload: RunPayload;
  definition: WorkflowDefinition;
  companyGroupId: string;
  startedAt: string;
  step: EngineStep;
  ledger: RunLedger;
  catalog: WorkflowCatalog;
  logger: EngineLogger;
  /** Which trigger to start from, when the caller knows. */
  triggerNodeId?: string;
}): Promise<{
  status: "Succeeded" | "Failed";
  steps: number;
  error: string | null;
}> {
  const {
    payload,
    definition,
    companyGroupId,
    startedAt,
    step,
    ledger,
    catalog,
    logger,
    triggerNodeId
  } = params;

  const granted = await step.run("permissions", async () => {
    const refuse = async (error: string) => {
      await ledger.finishRun({ status: "Failed", error, startedAt });
      return { ok: false as const, error };
    };

    const client = await getOwnerClient(payload.ownerId, payload.runId);
    const permissions = await readOwnerPermissions(
      client,
      payload.ownerId,
      payload.companyId
    );
    if (permissions === null) return refuse(NO_PERMISSIONS);

    // Checked explicitly as well as by RLS: RLS alone returns zero rows, which
    // reads as a silent skip rather than a lost permission.
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
    return { status: "Failed", steps: 0, error: granted.error };
  }

  const cache: EntityCache = new Map();
  const outputs: Record<string, Record<string, RuntimeValue>> = {};
  const trigger = findTriggerNodeForEvent(
    definition,
    payload.eventId,
    triggerNodeId
  );
  if (trigger !== undefined) {
    outputs[trigger.id] = triggerOutputs({
      eventId: payload.eventId,
      trigger: payload.trigger,
      catalog,
      cache
    });
  }

  // The trigger is recorded, never executed: the walk starts at its successors, so
  // without this row the run appears to begin nowhere and the first row reads as a
  // step that was skipped.
  if (trigger !== undefined) {
    await step.run(`node:${trigger.id}`, async () => {
      const claimedAt = datetime.timestamp();
      const claim = await ledger.claimStep({
        nodeId: trigger.id,
        nodeType: "trigger",
        itemKey: "",
        sequence: 0
      });
      if (!claim.claimed) return null;
      await ledger.settleStep({
        stepRunId: claim.stepRunId,
        status: "Succeeded",
        output: outputs[trigger.id] ?? {},
        startedAt: claimedAt
      });
      return null;
    });
  }

  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const state = createWalkState(definition, trigger?.id);
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

    const args: NodeArgs = {
      payload,
      ledger,
      node,
      sequence: state.sequence,
      outputs,
      permissions: granted.permissions,
      catalog,
      cache,
      companyGroupId
    };

    const plan = await resolveBatchItems(args);
    const outcome =
      plan === undefined
        ? await step.run(`node:${nodeId}`, () =>
            recordStep(args, "", (record) => runExecutor({ ...args, record }))
          )
        : await runBatchedNode(step, args, plan);

    executions += 1;
    if (outcome.status === "Failed" || (outcome.failedItems ?? 0) > 0) {
      failed = true;
    }
    if (outcome.outputs !== null) outputs[nodeId] = outcome.outputs;
    advance(state, definition, nodeId, outcome.handle);
  }

  const finished = await step.run("finish", async () => {
    const interrupted = await ledger.failInterruptedSteps();
    const settled =
      failed || capped || interrupted > 0
        ? ("Failed" as const)
        : ("Succeeded" as const);
    const error = capped ? TOO_MANY_STEPS : null;

    await ledger.finishRun({ status: settled, error, startedAt });
    return { status: settled, error };
  });

  logger.info(
    `Workflow run ${payload.runId} ${finished.status.toLowerCase()} after ${executions} steps`
  );

  return { ...finished, steps: executions };
}
