import type { KyselyDatabase } from "@carbon/database/client";
import { MAX_CHAIN_DEPTH, type Origin } from "@carbon/workflows";
import type { Kysely } from "kysely";
import type { CausingRun, MatchInput, RunTrace, Subscriber } from "./types";

const FRESH_TRACE: RunTrace = {
  rootRunId: null,
  causedByRunId: null,
  depth: 0,
  path: []
};

/** Person / Automation / Both, decided purely by the presence of the run tag. */
export function filterByOrigin(
  subscribers: Subscriber[],
  workflowRunId: string | null
): Subscriber[] {
  const origin = workflowRunId ? "Automation" : "Person";
  return subscribers.filter((s) => s.origin === "Both" || s.origin === origin);
}

/** The next hop's chain-tracking columns, derived from the causing run. */
export function deriveNextTrace(causing: CausingRun): RunTrace {
  return {
    rootRunId: causing.rootRunId ?? causing.id,
    causedByRunId: causing.id,
    depth: causing.depth + 1,
    path: causing.workflowId
      ? [...causing.path, causing.workflowId]
      : [...causing.path]
  };
}

/** Cycle and depth checks, evaluated before any run is created. */
export function evaluateLoopGuard(
  workflowId: string,
  trace: RunTrace
): { blocked: false } | { blocked: true; reason: string } {
  if (trace.path.includes(workflowId)) {
    return {
      blocked: true,
      reason: "Cycle: this workflow already ran in this chain"
    };
  }
  if (trace.depth >= MAX_CHAIN_DEPTH) {
    return {
      blocked: true,
      reason: `Chain depth limit reached (${MAX_CHAIN_DEPTH} hops)`
    };
  }
  return { blocked: false };
}

export type PlannedRun = {
  subscriber: Subscriber;
  status: "Queued" | "Blocked";
  statusReason: string | null;
  trace: RunTrace;
};

/**
 * Pure planning: dedupe to one run per workflow (first matching event id in
 * catalog order wins — the dedupe key would collapse them anyway), apply the
 * origin filter, then the loop guards. A blocked firing is planned as a
 * Blocked run, never dropped.
 */
export function planRuns(input: {
  subscribers: Subscriber[];
  eventIds: string[];
  workflowRunId: string | null;
  causingRun: CausingRun | null;
}): PlannedRun[] {
  const byWorkflow = new Map<string, Subscriber>();
  for (const eventId of input.eventIds) {
    for (const s of input.subscribers) {
      if (s.eventId === eventId && !byWorkflow.has(s.workflowId)) {
        byWorkflow.set(s.workflowId, s);
      }
    }
  }

  const survivors = filterByOrigin(
    [...byWorkflow.values()],
    input.workflowRunId
  );
  const trace = input.causingRun
    ? deriveNextTrace(input.causingRun)
    : FRESH_TRACE;

  return survivors.map((subscriber) => {
    const guard = evaluateLoopGuard(subscriber.workflowId, trace);
    return guard.blocked
      ? { subscriber, status: "Blocked", statusReason: guard.reason, trace }
      : { subscriber, status: "Queued", statusReason: null, trace };
  });
}

export type QueuedRunEvent = {
  name: "carbon/workflow-run.queued";
  id: string;
  data: {
    runId: string;
    companyId: string;
    workflowId: string;
    workflowVersionId: string;
    eventId: string;
    ownerId: string;
    sourceEventId: string;
    trigger: MatchInput["trigger"];
  };
};

export type MatchResult = {
  events: QueuedRunEvent[];
  queued: number;
  blocked: number;
  deduped: number;
};

/**
 * The matcher: subscribers -> origin filter -> loop guards -> one workflowRun
 * row per surviving workflow -> one queued event per row actually inserted.
 * A conflict on workflowRun_dedupe_key means this announcement was already
 * handled; nothing is sent for it.
 */
export async function matchAndQueue(
  db: Kysely<KyselyDatabase>,
  input: MatchInput
): Promise<MatchResult> {
  const rows = await db
    .selectFrom("workflowTriggerEvent as te")
    .innerJoin("workflow as w", (join) =>
      join
        .onRef("w.id", "=", "te.workflowId")
        .onRef("w.companyId", "=", "te.companyId")
    )
    .select([
      "te.workflowId",
      "te.workflowVersionId",
      "te.eventId",
      "te.origin",
      "w.ownerId"
    ])
    .where("te.companyId", "=", input.companyId)
    .where("te.eventId", "in", input.eventIds)
    .execute();

  // `origin` is a CHECK-constrained text column, so the DB types widen it to
  // string; narrowing here is the only unchecked step, not the whole row.
  const subscribers: Subscriber[] = rows.map((r) => ({
    ...r,
    origin: r.origin as Origin
  }));

  if (subscribers.length === 0) {
    return { events: [], queued: 0, blocked: 0, deduped: 0 };
  }

  let causingRun: CausingRun | null = null;
  if (input.workflowRunId) {
    const row = await db
      .selectFrom("workflowRun")
      .select(["id", "workflowId", "rootRunId", "depth", "path"])
      .where("id", "=", input.workflowRunId)
      .where("companyId", "=", input.companyId)
      .executeTakeFirst();
    // A purged/missing causing run: keep the chain countable (depth 1) even
    // though its path is unknowable.
    causingRun = row ?? {
      id: input.workflowRunId,
      workflowId: null,
      rootRunId: input.workflowRunId,
      depth: 0,
      path: []
    };
  }

  const planned = planRuns({
    subscribers,
    eventIds: input.eventIds,
    workflowRunId: input.workflowRunId,
    causingRun
  });

  if (planned.length === 0) {
    return { events: [], queued: 0, blocked: 0, deduped: 0 };
  }

  // One statement, so the whole firing lands or none of it does. ON CONFLICT
  // returns only the genuinely new rows, which is also the dedupe count.
  const inserted = await db
    .insertInto("workflowRun")
    .values(
      planned.map((plan) => ({
        companyId: input.companyId,
        workflowId: plan.subscriber.workflowId,
        workflowVersionId: plan.subscriber.workflowVersionId,
        eventId: plan.subscriber.eventId,
        sourceEventId: input.sourceEventId,
        triggerTable: input.triggerTable,
        triggerRecordId: input.triggerRecordId,
        ownerId: plan.subscriber.ownerId,
        status: plan.status,
        statusReason: plan.statusReason,
        rootRunId: plan.trace.rootRunId,
        causedByRunId: plan.trace.causedByRunId,
        depth: plan.trace.depth,
        path: plan.trace.path
      }))
    )
    .onConflict((oc) => oc.constraint("workflowRun_dedupe_key").doNothing())
    .returning(["id", "workflowId"])
    .execute();

  // Safe as a key: planRuns emits at most one plan per workflow.
  const runIdByWorkflow = new Map(inserted.map((r) => [r.workflowId, r.id]));

  const result: MatchResult = {
    events: [],
    queued: 0,
    blocked: 0,
    deduped: planned.length - inserted.length
  };

  for (const plan of planned) {
    const runId = runIdByWorkflow.get(plan.subscriber.workflowId);
    if (!runId) continue;
    if (plan.status === "Blocked") {
      result.blocked += 1;
      continue;
    }
    result.queued += 1;
    result.events.push({
      name: "carbon/workflow-run.queued",
      id: `${plan.subscriber.workflowId}:${plan.subscriber.workflowVersionId}:${input.sourceEventId}`,
      data: {
        runId,
        companyId: input.companyId,
        workflowId: plan.subscriber.workflowId,
        workflowVersionId: plan.subscriber.workflowVersionId,
        eventId: plan.subscriber.eventId,
        ownerId: plan.subscriber.ownerId,
        sourceEventId: input.sourceEventId,
        trigger: input.trigger
      }
    });
  }

  return result;
}
