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

/** Origin is decided purely by the presence of the run tag. */
export function filterByOrigin(
  subscribers: Subscriber[],
  workflowRunId: string | null
): Subscriber[] {
  const origin = workflowRunId ? "Automation" : "Person";
  return subscribers.filter((s) => s.origin === "Both" || s.origin === origin);
}

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

/**
 * A planned workflowRun row — the flat shape both the matcher and the scheduler produce.
 * The scheduler adds `Skipped`; the matcher produces only `Queued` and `Blocked`.
 */
export type PlannedRun = {
  workflowId: string;
  workflowVersionId: string;
  eventId: string;
  ownerId: string;
  status: "Queued" | "Blocked" | "Skipped";
  statusReason: string | null;
  rootRunId: string | null;
  causedByRunId: string | null;
  depth: number;
  path: string[];
};

/** One run per workflow — the first matching event id in catalog order wins.
 * A blocked firing is planned as a Blocked run, never dropped. */
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
  // A null causingRun means either a genuinely fresh firing or a causing run the
  // retention job already purged, and the two are indistinguishable here. So the
  // chain cap is best-effort across a 90-day boundary: a chain that outlives its
  // own root's history restarts at depth 0. Acceptable — the depth cap is 10 hops
  // and a chain cannot plausibly take 90 days to reach them.
  const trace = input.causingRun
    ? deriveNextTrace(input.causingRun)
    : FRESH_TRACE;

  return survivors.map((subscriber) => {
    const guard = evaluateLoopGuard(subscriber.workflowId, trace);
    return {
      workflowId: subscriber.workflowId,
      workflowVersionId: subscriber.workflowVersionId,
      eventId: subscriber.eventId,
      ownerId: subscriber.ownerId,
      status: guard.blocked ? ("Blocked" as const) : ("Queued" as const),
      statusReason: guard.blocked ? guard.reason : null,
      rootRunId: trace.rootRunId,
      causedByRunId: trace.causedByRunId,
      depth: trace.depth,
      path: trace.path
    };
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
 * The one place a workflowRun is created. One statement, so the whole firing lands or none of
 * it does; ON CONFLICT returns only the genuinely new rows, which is also the dedupe count.
 * Only Queued rows produce an event — Blocked and Skipped rows exist to be read in run history.
 */
export async function insertRunsAndBuildEvents(
  db: Kysely<KyselyDatabase>,
  params: {
    companyId: string;
    sourceEventId: string;
    triggerTable: string | null;
    triggerRecordId: string | null;
    trigger: MatchInput["trigger"];
    planned: PlannedRun[];
  }
): Promise<MatchResult> {
  const {
    companyId,
    sourceEventId,
    triggerTable,
    triggerRecordId,
    trigger,
    planned
  } = params;

  const inserted = await db
    .insertInto("workflowRun")
    .values(
      planned.map((plan) => ({
        companyId,
        workflowId: plan.workflowId,
        workflowVersionId: plan.workflowVersionId,
        eventId: plan.eventId,
        sourceEventId,
        triggerTable,
        triggerRecordId,
        ownerId: plan.ownerId,
        status: plan.status,
        statusReason: plan.statusReason,
        rootRunId: plan.rootRunId,
        causedByRunId: plan.causedByRunId,
        depth: plan.depth,
        path: plan.path
      }))
    )
    .onConflict((oc) => oc.constraint("workflowRun_dedupe_key").doNothing())
    .returning(["id", "workflowId"])
    .execute();

  const runIdByWorkflow = new Map(inserted.map((r) => [r.workflowId, r.id]));

  const result: MatchResult = {
    events: [],
    queued: 0,
    blocked: 0,
    deduped: planned.length - inserted.length
  };

  for (const plan of planned) {
    const runId = runIdByWorkflow.get(plan.workflowId);
    if (!runId) continue;
    if (plan.status === "Blocked" || plan.status === "Skipped") {
      if (plan.status === "Blocked") result.blocked += 1;
      continue;
    }
    result.queued += 1;
    result.events.push({
      name: "carbon/workflow-run.queued",
      id: `${plan.workflowId}:${plan.workflowVersionId}:${sourceEventId}`,
      data: {
        runId,
        companyId,
        workflowId: plan.workflowId,
        workflowVersionId: plan.workflowVersionId,
        eventId: plan.eventId,
        ownerId: plan.ownerId,
        sourceEventId,
        trigger
      }
    });
  }

  return result;
}

/**
 * Subscribers -> origin filter -> loop guards -> one workflowRun row per
 * surviving workflow -> one queued event per row actually inserted.
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

  // `origin` is a CHECK-constrained text column, so the DB types widen it to string.
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
    // A purged causing run still keeps the chain countable, though its path is lost.
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

  return insertRunsAndBuildEvents(db, {
    companyId: input.companyId,
    sourceEventId: input.sourceEventId,
    triggerTable: input.triggerTable,
    triggerRecordId: input.triggerRecordId,
    trigger: input.trigger,
    planned
  });
}
