// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The planning worklist's write (`planningAction`): the natural key an action
// keeps from run to run, the diff of one run against the stored rows, and the
// diff-write, in one transaction that holds the company's planning lock.
//
// Persistence is a DIFF-WRITE keyed on the natural key (item, location, type,
// period, target document): Open rows update in place (a human-overridden
// assignee is never re-resolved), Dismissed rows stay dismissed unless the
// suggestion changed materially, vanished Open/Dismissed rows are deleted so a
// returning need re-surfaces, and Actioned rows are terminal. Failures
// PROPAGATE to the caller — a run must not report success with stale actions.

import type { DB } from "@carbon/database/client";
import { COMMON_SEGMENT, KEY_SEP } from "@carbon/database/mrp-engine";
import { lockCompanyPlanning } from "@carbon/database/planning-lock";
import type {
  GroupPegInput,
  PegPriorityRule,
  WriteGroupPegs
} from "@carbon/ee/pegging";
import { getLogger } from "@carbon/logger";
import { datetime, equals } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { lastSavedMrpRunStartedAt, newestRunSaves } from "../run-order.ts";
import { toIsoDate } from "../scheduling/date-utils.ts";
import { jsonEquals } from "./json-equals.ts";
import {
  assertPlannedOrdersUnchanged,
  type PlannedOrderSnapshot
} from "./planned-order-write.ts";
import type {
  PlanningActionCandidate,
  PlanningActionSegment,
  PlanningActionType
} from "./planning-action-types.ts";
import { onePerPlannedOrder } from "./row-actions.ts";
import { daysBetween, supplyTarget } from "./row-sizing.ts";

const logger = getLogger("planning", "planning-actions");

const BATCH_SIZE = 500;

export type ExistingPlanningAction = {
  id: string;
  itemId: string;
  locationId: string;
  periodId: string;
  type: PlanningActionType;
  status: "Open" | "Dismissed";
  suggestedQuantity: number;
  suggestedDate: string;
  horizonDate: string;
  latestOrderDate: string | null;
  isASAP: boolean;
  purchaseOrderLineId: string | null;
  jobId: string | null;
  plannedOrderId: string | null;
  requiresManualAction: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: unknown;
  assignee: string | null;
  assigneeOverridden: boolean;
} & PlanningActionSegment;

/**
 * The identity an action keeps from run to run.
 *
 * Every action belongs to its netting segment, so one item and week can hold
 * a common Order and a project's Order. A Transfer is also keyed on the owners
 * it moves stock between ('' when common): two Transfers into one segment
 * from different owners are two actions.
 *
 * A change action belongs to its ORDER: item, location, type and target. Its
 * period (the week of the need it was measured against) is data, so a need
 * that moves a week updates the same row instead of replacing it.
 *
 * A new-supply action (Order / Make) has no order yet, so its week is its
 * identity — except that every week up to the current one is one "now" key
 * (`keyPeriod`). MRP puts all current and overdue demand in the first week,
 * which is a different week every Sunday; keyed on it, a shortage that went on
 * got a new row each week and lost its dismissal and its hand-set assignee.
 */
export function naturalKey(
  action: {
    itemId: string;
    locationId: string;
    type: string;
    periodId: string;
    purchaseOrderLineId: string | null;
    jobId: string | null;
    plannedOrderId: string | null;
  } & PlanningActionSegment,
  keyPeriod: (periodId: string) => string = (periodId) => periodId
): string {
  const target = supplyTarget(action);
  return [
    action.itemId,
    action.locationId,
    action.planningSegmentId ?? COMMON_SEGMENT,
    action.type,
    target ? `order:${target}` : `period:${keyPeriod(action.periodId)}`,
    action.fromProjectId ?? "",
    action.toProjectId ?? ""
  ].join(KEY_SEP);
}

/**
 * `naturalKey`'s period mapping for one run: the current week, and any week
 * before it (a row written in an earlier week), are all "now".
 */
export function keyPeriodFor(
  periods: { id: string }[]
): (periodId: string) => string {
  const current = periods[0]?.id;
  const later = new Set(periods.slice(1).map((p) => p.id));
  return (periodId) =>
    periodId === current || !later.has(periodId) ? "now" : periodId;
}

export type PlanningActionDiff = {
  inserts: PlanningActionCandidate[];
  updates: {
    id: string;
    patch: Record<string, unknown>;
  }[];
  deleteIds: string[];
};

/**
 * Diff-write plan: never delete-and-recreate — assignment and dismissal state
 * must survive a run. Two identical consecutive runs produce zero changes.
 */
export function diffPlanningActions(args: {
  existing: ExistingPlanningAction[];
  candidates: PlanningActionCandidate[];
  toleranceDays: number;
  /** This run's weeks, current first; their ids decide what is "now". */
  periods?: { id: string }[];
}): PlanningActionDiff {
  const { existing, candidates, toleranceDays } = args;
  const keyPeriod = args.periods ? keyPeriodFor(args.periods) : undefined;
  const keyOf = (action: Parameters<typeof naturalKey>[0]) =>
    naturalKey(action, keyPeriod);

  // Two stored rows can share a "now" key (last week's current-week row and
  // one written for this week): keep the one already on the current week; the
  // other is deleted below as unseen.
  const currentPeriodId = args.periods?.[0]?.id;
  const existingByKey = new Map<string, ExistingPlanningAction>();
  for (const row of existing) {
    const key = keyOf(row);
    const kept = existingByKey.get(key);
    if (!kept || row.periodId === currentPeriodId) existingByKey.set(key, row);
  }
  const keptIds = new Set([...existingByKey.values()].map((row) => row.id));
  const seen = new Set<string>();

  const inserts: PlanningActionCandidate[] = [];
  const updates: PlanningActionDiff["updates"] = [];

  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (seen.has(key)) continue; // one action per natural key
    seen.add(key);

    const current = existingByKey.get(key);
    if (!current) {
      inserts.push(candidate);
      continue;
    }

    const materialChange =
      !equals(current.suggestedQuantity, candidate.suggestedQuantity) ||
      Math.abs(daysBetween(current.suggestedDate, candidate.suggestedDate)) >
        toleranceDays;

    const patch: Record<string, unknown> = {};
    // The week and the grid-facing dates track the candidate on every row,
    // dismissed ones included: keeping them current never re-opens anything.
    if (current.periodId !== candidate.periodId) {
      patch.periodId = candidate.periodId;
    }
    if (current.horizonDate !== candidate.horizonDate) {
      patch.horizonDate = candidate.horizonDate;
    }
    if ((current.latestOrderDate ?? null) !== candidate.latestOrderDate) {
      patch.latestOrderDate = candidate.latestOrderDate;
    }

    if (current.status === "Dismissed" && !materialChange) {
      // dismissed suppresses a persisting, unchanged need
      if (Object.keys(patch).length > 0) {
        updates.push({ id: current.id, patch });
      }
      continue;
    }

    if (current.status === "Dismissed") patch.status = "Open";
    if (!equals(current.suggestedQuantity, candidate.suggestedQuantity)) {
      patch.suggestedQuantity = candidate.suggestedQuantity;
    }
    if (current.suggestedDate !== candidate.suggestedDate) {
      patch.suggestedDate = candidate.suggestedDate;
    }
    if (current.isASAP !== candidate.isASAP) patch.isASAP = candidate.isASAP;
    if (current.requiresManualAction !== candidate.requiresManualAction) {
      patch.requiresManualAction = candidate.requiresManualAction;
    }
    if (
      (current.plannedOrderId ?? null) !== (candidate.plannedOrderId ?? null)
    ) {
      patch.plannedOrderId = candidate.plannedOrderId ?? null;
    }
    if ((current.supplierId ?? null) !== candidate.supplierId) {
      patch.supplierId = candidate.supplierId;
    }
    if ((current.policyName ?? null) !== candidate.policyName) {
      patch.policyName = candidate.policyName;
    }
    if ((current.reason ?? null) !== candidate.reason) {
      patch.reason = candidate.reason;
    }
    if (
      !jsonEquals(
        current.triggerValues ?? null,
        candidate.triggerValues ?? null
      )
    ) {
      patch.triggerValues = candidate.triggerValues;
    }
    if (
      !current.assigneeOverridden &&
      (current.assignee ?? null) !== candidate.assignee
    ) {
      patch.assignee = candidate.assignee;
    }

    if (Object.keys(patch).length > 0) {
      updates.push({ id: current.id, patch });
    }
  }

  const deleteIds = existing
    .filter((e) => !keptIds.has(e.id) || !seen.has(keyOf(e)))
    .map((e) => e.id);

  return { inserts, updates, deleteIds };
}

/**
 * The Postgres type of every column a diff patch can set: the cast each
 * `VALUES` column needs, since a bound parameter arrives untyped. A patch key
 * missing here is a programming error and throws before anything is written.
 */
const PATCH_COLUMN_TYPES: Record<string, string> = {
  periodId: "text",
  horizonDate: "date",
  latestOrderDate: "date",
  status: '"planningActionStatus"',
  suggestedQuantity: "numeric",
  suggestedDate: "date",
  isASAP: "boolean",
  requiresManualAction: "boolean",
  plannedOrderId: "text",
  supplierId: "text",
  policyName: "text",
  reason: "text",
  triggerValues: "jsonb",
  assignee: "text"
};

/**
 * The diff's updates grouped by the columns they change, one group per
 * statement, each row as its `VALUES` tuple (`id`, then the group's columns).
 * Throws on a column with no known type before anything is written.
 */
export function groupPatchUpdates(
  updates: PlanningActionDiff["updates"]
): { columns: string[]; rows: unknown[][] }[] {
  const groups = new Map<string, PlanningActionDiff["updates"]>();
  for (const update of updates) {
    const shape = Object.keys(update.patch).sort().join(",");
    const group = groups.get(shape);
    if (group) group.push(update);
    else groups.set(shape, [update]);
  }

  return [...groups].map(([shape, group]) => {
    const columns = shape.split(",");
    for (const column of columns) {
      if (!PATCH_COLUMN_TYPES[column]) {
        throw new Error(`No column type for planning action patch "${column}"`);
      }
    }
    return {
      columns,
      rows: group.map((row) => [
        row.id,
        ...columns.map((column) => {
          const value = row.patch[column] ?? null;
          return column === "triggerValues" && value !== null
            ? JSON.stringify(value)
            : value;
        })
      ])
    };
  });
}

/**
 * Writes one run's diff inside the caller's transaction.
 *
 * The run read the actions before it computed this diff, so a row a planner
 * applied in between still reads as Open or Dismissed here. Every DELETE and
 * UPDATE therefore skips `Actioned` rows itself: without that, the run deleted
 * an applied action (and its claim) or reopened it with a `status: "Open"`
 * patch, offering it to be applied twice.
 *
 * Updates are grouped by the columns they change and sent as one
 * `UPDATE … FROM (VALUES …)` per group and chunk. They were one statement per
 * row — thousands of round trips on the weekly roll of the first period, with
 * the transaction holding a connection of the job pool throughout. Each row
 * keeps its own patch: writing every column would also move a dismissed row's
 * stored quantity, and a changed need would then never cross the tolerance.
 */
export async function writePlanningActionDiff(
  trx: Kysely<DB>,
  args: {
    companyId: string;
    userId: string;
    diff: PlanningActionDiff;
    updatedAt: string;
  }
): Promise<void> {
  const { companyId, userId, diff, updatedAt } = args;

  for (let i = 0; i < diff.deleteIds.length; i += BATCH_SIZE) {
    await trx
      .deleteFrom("planningAction")
      .where("companyId", "=", companyId)
      .where("status", "!=", "Actioned")
      .where("id", "in", diff.deleteIds.slice(i, i + BATCH_SIZE))
      .execute();
  }

  for (const { columns, rows } of groupPatchUpdates(diff.updates)) {
    // The diff skipped an overridden assignee when it READ the row, but a
    // planner can assign between that read and this write (Assign does not
    // take the run's lock), so the statement re-checks the flag on the row.
    const assignments = sql.join(
      columns.map((column) =>
        column === "assignee"
          ? sql`"assignee" = CASE WHEN t."assigneeOverridden" THEN t."assignee" ELSE v."assignee"::text END`
          : sql`${sql.id(column)} = v.${sql.id(column)}::${sql.raw(
              PATCH_COLUMN_TYPES[column]!
            )}`
      )
    );
    const valueColumns = sql.join(["id", ...columns].map((c) => sql.id(c)));

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const values = sql.join(
        rows.slice(i, i + BATCH_SIZE).map((row) => sql`(${sql.join(row)})`)
      );
      await sql`
        UPDATE "planningAction" AS t
        SET ${assignments}, "updatedBy" = ${userId}, "updatedAt" = ${updatedAt}
        FROM (VALUES ${values}) AS v(${valueColumns})
        WHERE t."id" = v."id"
          AND t."companyId" = ${companyId}
          AND t."status" <> 'Actioned'
      `.execute(trx);
    }
  }

  for (let i = 0; i < diff.inserts.length; i += BATCH_SIZE) {
    const chunk = diff.inserts.slice(i, i + BATCH_SIZE);
    await trx
      .insertInto("planningAction")
      .values(
        chunk.map((candidate) => ({
          companyId,
          itemId: candidate.itemId,
          locationId: candidate.locationId,
          periodId: candidate.periodId,
          type: candidate.type,
          suggestedQuantity: candidate.suggestedQuantity,
          suggestedDate: candidate.suggestedDate,
          horizonDate: candidate.horizonDate,
          latestOrderDate: candidate.latestOrderDate,
          isASAP: candidate.isASAP,
          purchaseOrderLineId: candidate.purchaseOrderLineId,
          jobId: candidate.jobId,
          plannedOrderId: candidate.plannedOrderId ?? null,
          requiresManualAction: candidate.requiresManualAction,
          supplierId: candidate.supplierId,
          policyName: candidate.policyName,
          reason: candidate.reason,
          triggerValues: candidate.triggerValues
            ? JSON.stringify(candidate.triggerValues)
            : null,
          assignee: candidate.assignee,
          planningSegmentId: candidate.planningSegmentId ?? COMMON_SEGMENT,
          fromProjectId: candidate.fromProjectId ?? null,
          toProjectId: candidate.toProjectId ?? null,
          createdBy: userId
        }))
      )
      .execute();
  }
}

/**
 * Projects Phase 3: adds each planned Order / Make of a planning group
 * segment to its peg input, as a `Planning Action` supply named by the
 * action's id. A candidate maps to the stored action with its natural key;
 * one with no stored action (not written) is left out.
 */
export function withPlannedPegSupplies(args: {
  inputs: GroupPegInput[];
  candidates: PlanningActionCandidate[];
  /** `naturalKey` (with this run's `keyPeriod`) -> the stored action id. */
  actionIdByKey: ReadonlyMap<string, string>;
  keyPeriod: (periodId: string) => string;
  groupIds: ReadonlySet<string>;
}): GroupPegInput[] {
  const byKey = new Map<string, GroupPegInput>();
  const inputs = args.inputs.map((input) => {
    const copy = { ...input, supplies: [...input.supplies] };
    byKey.set(
      [input.planningGroupId, input.itemId, input.locationId].join(KEY_SEP),
      copy
    );
    return copy;
  });
  const placed = new Set<string>();
  for (const candidate of args.candidates) {
    if (candidate.type !== "Order" && candidate.type !== "Make") continue;
    const groupId = candidate.planningSegmentId ?? COMMON_SEGMENT;
    if (!args.groupIds.has(groupId)) continue;
    const actionId = args.actionIdByKey.get(
      naturalKey(candidate, args.keyPeriod)
    );
    if (!actionId || placed.has(actionId)) continue;
    placed.add(actionId);
    const key = [groupId, candidate.itemId, candidate.locationId].join(KEY_SEP);
    let input = byKey.get(key);
    if (!input) {
      input = {
        planningGroupId: groupId,
        itemId: candidate.itemId,
        locationId: candidate.locationId,
        demands: [],
        supplies: []
      };
      byKey.set(key, input);
      inputs.push(input);
    }
    input.supplies.push({
      supplyType: "Planning Action",
      supplyId: actionId,
      ownerProjectId: null,
      availableDate: candidate.suggestedDate,
      quantity: candidate.suggestedQuantity
    });
  }
  return inputs;
}

/**
 * Projects Phase 3: the peg writer's inputs, passed only when the company has
 * PLANNING_GROUPS. The pegs are diff-written in the worklist's transaction,
 * after the actions, so a planned supply has its action id. `writeGroupPegs`
 * is the commercial writer, injected by the server-side caller (`MrpDeps`):
 * this package imports no `.server` module.
 */
export type PlanningActionPegging = {
  writeGroupPegs: WriteGroupPegs;
  runId: string;
  inputs: GroupPegInput[];
  priorityRuleByGroup: Record<string, PegPriorityRule>;
  priorityByProject: Record<string, number>;
};

/**
 * The worklist's diff-write, in one transaction that holds the company's
 * planning lock across the read and the write: two runs for one company
 * could overlap (the cron racing a route-triggered run), and both reading
 * "no row" for a natural key then inserting fails the second on
 * planningAction_natural_key_idx — which rolls back the whole write. Under
 * the lock the second run reads the first run's rows and updates them in
 * place instead.
 *
 * With `plannedOrderSnapshot` (what the run's planned-order write committed),
 * it first checks, under the lock, that no one changed the planned orders
 * since, and throws `PlannedOrdersChangedError` before any read or write
 * when someone did: a Cancel deleted a planned order a candidate names (its
 * insert would fail on the foreign key), or a convert left a week this
 * worklist would offer again. `runMrp` then plans again.
 *
 * A change action names a job or PO line from the run's first read, and
 * nothing stops a person deleting that document before this write: its
 * insert would fail on the foreign key and the run with it. So, under the
 * lock, the documents and planned orders the candidates name are read
 * `FOR KEY SHARE` (no one can delete them until this transaction ends), and
 * a candidate whose target is gone is dropped (`withLiveTargets`).
 */
export async function writePlanningActions(
  db: Kysely<DB>,
  args: {
    companyId: string;
    userId: string;
    candidates: PlanningActionCandidate[];
    periods: { id: string; startDate: string }[];
    toleranceDays: number;
    pegging?: PlanningActionPegging;
    plannedOrderSnapshot?: PlannedOrderSnapshot;
    /** When the calling MRP run started (`databaseNow`): when a run that
     *  started later has saved since, it writes the actions and this one
     *  writes none (null). */
    runStartedAt?: string;
  }
): Promise<PlanningActionDiff | null> {
  const { companyId, userId, candidates, periods, pegging } = args;
  return db.transaction().execute(async (trx) => {
    await lockCompanyPlanning(trx, companyId);
    // A newer run that saved changed the planned orders too: skip before the
    // snapshot check, which would otherwise make this older run plan again.
    if (
      args.runStartedAt &&
      !newestRunSaves(
        args.runStartedAt,
        await lastSavedMrpRunStartedAt(trx, companyId)
      )
    ) {
      logger.info("planning actions skipped: a newer MRP run saved", {
        companyId,
        runStartedAt: args.runStartedAt
      });
      return null;
    }
    if (args.plannedOrderSnapshot) {
      await assertPlannedOrdersUnchanged(
        trx,
        companyId,
        args.plannedOrderSnapshot
      );
    }

    const { kept: liveCandidates, dropped } = withLiveTargets(
      candidates,
      await readLiveTargets(trx, companyId, candidates)
    );
    if (dropped.jobs + dropped.purchaseOrderLines + dropped.plannedOrders > 0) {
      logger.info("planning actions dropped: their order is gone", {
        companyId,
        ...dropped
      });
    }

    const existingRows = await trx
      .selectFrom("planningAction")
      .select([
        "id",
        "itemId",
        "locationId",
        "periodId",
        "type",
        "status",
        "suggestedQuantity",
        "suggestedDate",
        "horizonDate",
        "latestOrderDate",
        "isASAP",
        "purchaseOrderLineId",
        "jobId",
        "plannedOrderId",
        "requiresManualAction",
        "supplierId",
        "policyName",
        "reason",
        "triggerValues",
        "assignee",
        "assigneeOverridden",
        "planningSegmentId",
        "fromProjectId",
        "toProjectId"
      ])
      .where("companyId", "=", companyId)
      .where("status", "!=", "Actioned")
      .execute();

    const existing: ExistingPlanningAction[] = existingRows.map((row) => ({
      ...row,
      type: row.type as PlanningActionType,
      status: row.status as "Open" | "Dismissed",
      suggestedQuantity: Number(row.suggestedQuantity),
      suggestedDate: toIsoDate(row.suggestedDate as unknown as string | Date)!,
      horizonDate: toIsoDate(row.horizonDate as unknown as string | Date)!,
      latestOrderDate: row.latestOrderDate
        ? toIsoDate(row.latestOrderDate as unknown as string | Date)
        : null,
      triggerValues: row.triggerValues ?? null
    }));

    const diff = diffPlanningActions({
      existing,
      candidates: onePerPlannedOrder(liveCandidates),
      periods,
      toleranceDays: args.toleranceDays
    });

    await writePlanningActionDiff(trx, {
      companyId,
      userId,
      diff,
      updatedAt: datetime.timestamp()
    });

    if (pegging) {
      const pegs = await writePegs(trx, {
        companyId,
        userId,
        pegging,
        candidates: liveCandidates,
        keyPeriod: keyPeriodFor(periods)
      });
      logger.info("project pegs written", { companyId, ...pegs });
    }

    return diff;
  });
}

/** The orders the candidates name that still exist, by kind. */
export type LiveTargets = {
  jobIds: ReadonlySet<string>;
  purchaseOrderLineIds: ReadonlySet<string>;
  plannedOrderIds: ReadonlySet<string>;
};

/**
 * The candidates whose target still exists, and how many of each kind were
 * dropped. A candidate with no target (new supply, a Transfer) is kept.
 */
export function withLiveTargets(
  candidates: PlanningActionCandidate[],
  live: LiveTargets
): {
  kept: PlanningActionCandidate[];
  dropped: { jobs: number; purchaseOrderLines: number; plannedOrders: number };
} {
  const dropped = { jobs: 0, purchaseOrderLines: 0, plannedOrders: 0 };
  const kept = candidates.filter((candidate) => {
    if (
      candidate.purchaseOrderLineId &&
      !live.purchaseOrderLineIds.has(candidate.purchaseOrderLineId)
    ) {
      dropped.purchaseOrderLines++;
      return false;
    }
    if (candidate.jobId && !live.jobIds.has(candidate.jobId)) {
      dropped.jobs++;
      return false;
    }
    if (
      candidate.plannedOrderId &&
      !live.plannedOrderIds.has(candidate.plannedOrderId)
    ) {
      dropped.plannedOrders++;
      return false;
    }
    return true;
  });
  return { kept, dropped };
}

/**
 * Which of the jobs, PO lines and planned orders the candidates name still
 * exist: one read each (none for an empty list), `FOR KEY SHARE`, so none of
 * them can be deleted before the transaction ends.
 */
async function readLiveTargets(
  trx: Kysely<DB>,
  companyId: string,
  candidates: PlanningActionCandidate[]
): Promise<LiveTargets> {
  const idsOf = (key: "jobId" | "purchaseOrderLineId" | "plannedOrderId") => [
    ...new Set(
      candidates.flatMap((candidate) => {
        const id = candidate[key];
        return id ? [id] : [];
      })
    )
  ];
  const read = async (
    table: "job" | "purchaseOrderLine" | "plannedOrder",
    ids: string[]
  ): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const rows = await trx
      .selectFrom(table)
      .select("id")
      .where("companyId", "=", companyId)
      .where((eb) => eb("id", "=", eb.fn.any(eb.val(ids))))
      .forKeyShare()
      .execute();
    return new Set(rows.map((row) => row.id));
  };
  // one transaction, one connection: the reads go one after another
  const jobIds = await read("job", idsOf("jobId"));
  const purchaseOrderLineIds = await read(
    "purchaseOrderLine",
    idsOf("purchaseOrderLineId")
  );
  const plannedOrderIds = await read("plannedOrder", idsOf("plannedOrderId"));
  return { jobIds, purchaseOrderLineIds, plannedOrderIds };
}

/**
 * Reads the stored Order / Make actions of the planning groups, adds them to
 * the peg inputs as planned supply, and runs the commercial peg writer. Runs
 * in the planning-action transaction, which holds the company's lock.
 */
async function writePegs(
  trx: Kysely<DB>,
  args: {
    companyId: string;
    userId: string;
    pegging: PlanningActionPegging;
    candidates: PlanningActionCandidate[];
    keyPeriod: (periodId: string) => string;
  }
) {
  const { companyId, userId, pegging } = args;
  const groupIds = new Set(Object.keys(pegging.priorityRuleByGroup));
  const actionRows =
    groupIds.size > 0
      ? await trx
          .selectFrom("planningAction")
          .select([
            "id",
            "itemId",
            "locationId",
            "periodId",
            "type",
            "purchaseOrderLineId",
            "jobId",
            "plannedOrderId",
            "planningSegmentId",
            "fromProjectId",
            "toProjectId"
          ])
          .where("companyId", "=", companyId)
          .where("status", "!=", "Actioned")
          .where("type", "in", ["Order", "Make"])
          .where("planningSegmentId", "in", [...groupIds])
          .execute()
      : [];
  const actionIdByKey = new Map(
    actionRows.map((row) => [naturalKey(row, args.keyPeriod), row.id])
  );
  return pegging.writeGroupPegs(trx, {
    companyId,
    userId,
    runId: pegging.runId,
    inputs: withPlannedPegSupplies({
      inputs: pegging.inputs,
      candidates: args.candidates,
      actionIdByKey,
      keyPeriod: args.keyPeriod,
      groupIds
    }),
    priorityRuleByGroup: pegging.priorityRuleByGroup,
    priorityByProject: pegging.priorityByProject
  });
}
