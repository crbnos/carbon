// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Planning action messages (spec §P1) — the persisted, assignable output of an
// MRP run. One row per suggested action:
//
//   Order / Make          — create new supply (from the shared reorder sizing)
//   Expedite / Defer      — move an existing open PO line / job (date)
//   Increase / Decrease   — change an existing order's quantity
//   Cancel                — an existing order has no remaining requirement
//   Transfer              — move common stock a project segment needs into
//                           the project (from the common segment's true surplus),
//                           or a planning group member's permanent excess to a
//                           short sibling (Projects Phase 3)
//   Borrow                — lend a member's stock to a short sibling until the
//                           member needs it back (Projects Phase 3)
//
// Every action belongs to a netting segment (`planningSegmentId`): '' is
// common, a project id is a project with project stock. Each segment is
// planned on its own; a project segment is lot-for-lot, with no reorder
// point, safety stock or Stock Only reserve.
//
// Change actions follow the SAP "rescheduling check on a firmed receipt" model:
// open orders are matched to dated requirements chronologically; a date gap
// STRICTLY greater than companySettings.rescheduleToleranceDays fires
// Expedite/Defer; exactly ONE action is emitted per target document
// (Cancel → Expedite/Defer → Increase/Decrease).
//
// Persistence is a DIFF-WRITE keyed on the natural key (item, location, type,
// period, target document): Open rows update in place (a human-overridden
// assignee is never re-resolved), Dismissed rows stay dismissed unless the
// suggestion changed materially, vanished Open/Dismissed rows are deleted so a
// returning need re-surfaces, and Actioned rows are terminal. Failures
// PROPAGATE to the caller — a run must not report success with stale actions.
//
// Actions are generated over the WHOLE planning window. The per-item planning
// horizon (time fence) is a read-time lens applied by the planning grids, which
// compare each row's `horizonDate` with today + horizon days — so a planner can
// widen the fence on screen without a run. Nothing here reads the horizon.

import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { COMMON_SEGMENT, KEY_SEP } from "@carbon/database/mrp-engine";
import type {
  GroupPegInput,
  MemberMove,
  MemberPosition,
  PegPriorityRule,
  WriteGroupPegs
} from "@carbon/ee/pegging";
import { getLogger } from "@carbon/logger";
import { datetime, equals, round } from "@carbon/utils";
import { parseDate, startOfWeek } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import { toIsoDate } from "../scheduling/date-utils.ts";
import { groupByProjectOf, planningSegmentOf } from "./plan-company.ts";
import type {
  ChangeCandidate,
  OpenSupplyOrder,
  PlannedOrderRelease,
  PlanningActionCandidate,
  PlanningActionSegment,
  PlanningActionType
} from "./planning-action-types.ts";
import { loadResponsibleEmployeeResolver } from "./responsible-employee.ts";
import {
  DAYS_PER_PERIOD,
  daysBetween,
  drawsByPeriod,
  earlierDate,
  laterDate,
  sizeRowSupply
} from "./row-sizing.ts";
import {
  jobCompletionDate,
  purchaseOrderLineArrivalDate
} from "./supply-date.ts";

export type {
  OpenSupplyOrder,
  PlannedOrderRelease,
  PlanningActionCandidate,
  PlanningActionSegment,
  PlanningActionType
} from "./planning-action-types.ts";
export {
  convertOrdersToIncreases,
  type DeriveChangeActionsInput,
  daysBetween,
  deriveChangeActions,
  earlierDate,
  firstNeedPeriodByOrder,
  isOrderFrozen,
  laterDate,
  projectionsWithExpedites,
  quantityAfterApply
} from "./row-sizing.ts";

const logger = getLogger("planning", "planning-actions");

const WEEKS_TO_PLAN = 48;
const BATCH_SIZE = 500;
/**
 * A Release is raised this many days before its release day, not earlier.
 * Every planned order has one, so raised the moment the order exists it is a
 * standing row weeks ahead of anything anyone can do about it.
 */
const RELEASE_NOTICE_DAYS = 1;

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
  requiresManualAction: boolean;
  supplierId: string | null;
  policyName: string | null;
  reason: string | null;
  triggerValues: unknown;
  assignee: string | null;
  assigneeOverridden: boolean;
} & PlanningActionSegment;

/**
 * The view only yields open POs ('Planned' | 'To Receive' | 'To Receive and
 * Invoice'); anything past 'Planned'/'Draft' has been sent to the supplier
 * (mirrors PURCHASE_ORDER_LOCKED_STATUSES in purchasing.models.ts). Never gate
 * on orderDate — insertPurchaseOrder defaults it to today for planned POs.
 */
export function isCommittedPurchaseOrderStatus(
  status: Database["public"]["Enums"]["purchaseOrderStatus"] | null | undefined
): boolean {
  return status !== "Planned" && status !== "Draft";
}

/** Job statuses at/after release-to-floor are committed supply. */
export function isCommittedJobStatus(
  status: Database["public"]["Enums"]["jobStatus"] | null | undefined
): boolean {
  return status === "Ready" || status === "In Progress" || status === "Paused";
}

/**
 * The last day to release a planned order so it still arrives on time: its
 * due date less the item's lead time, less one more day. Due in 8 days with a
 * 7-day lead time is today.
 */
export function releaseByDate(dueDate: string, leadTimeDays: number): string {
  return parseDate(dueDate)
    .subtract({ days: Math.max(leadTimeDays, 0) + 1 })
    .toString();
}

/** The earlier of two releases (a purchase order is released once, for the
 *  line that needs it first). */
export function earlierRelease(
  a: PlannedOrderRelease | null | undefined,
  b: PlannedOrderRelease
): PlannedOrderRelease {
  // daysBetween(a, b) is a − b
  return a && daysBetween(a.date, b.date) <= 0 ? a : b;
}

/**
 * One Release per planned order (`OpenSupplyOrder.release`), dated the last
 * day to release it, raised only from `RELEASE_NOTICE_DAYS` before that day.
 * Released from the order itself — the planning pages link to it — so it is
 * never applied. An order MRP would Cancel gets none.
 */
export function deriveReleaseActions(args: {
  openOrders: OpenSupplyOrder[];
  changeActions: Pick<
    ChangeCandidate,
    "type" | "purchaseOrderLineId" | "jobId"
  >[];
  periods: { id: string; startDate: string }[];
  todayDate: string;
}): ChangeCandidate[] {
  const { openOrders, changeActions, periods, todayDate } = args;
  const cancelled = new Set(
    changeActions
      .filter((a) => a.type === "Cancel")
      .map((a) => a.purchaseOrderLineId ?? a.jobId)
  );
  // the week a date falls in; an earlier date is the first week
  const periodFor = (dateIso: string) => {
    let match = periods[0];
    for (const p of periods) {
      if (daysBetween(p.startDate, dateIso) <= 0) match = p;
      else break;
    }
    return match;
  };

  const actions: ChangeCandidate[] = [];
  for (const order of openOrders) {
    const release = order.release;
    if (!release) continue;
    // not yet: the run on the day before raises it
    if (daysBetween(release.date, todayDate) > RELEASE_NOTICE_DAYS) continue;
    if (cancelled.has(order.purchaseOrderLineId ?? order.jobId ?? null)) {
      continue;
    }
    const period = periodFor(release.date);
    if (!period) continue;
    actions.push({
      type: "Release",
      periodId: period.id,
      suggestedQuantity: order.quantity,
      suggestedDate: release.date,
      horizonDate: release.date,
      // the latest-order-date column is for new supply, not this
      latestOrderDate: null,
      // its day has come (or gone): release it now
      isASAP: daysBetween(release.date, todayDate) <= 0,
      purchaseOrderLineId: order.purchaseOrderLineId ?? null,
      jobId: order.jobId ?? null,
      requiresManualAction: false,
      supplierId: order.supplierId ?? null,
      policyName: null,
      reason: `Due ${release.dueDate} with a ${release.leadTime}-day lead time`,
      triggerValues: { leadTime: release.leadTime }
    });
  }
  return actions;
}

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
  } & PlanningActionSegment,
  keyPeriod: (periodId: string) => string = (periodId) => periodId
): string {
  const target = action.purchaseOrderLineId ?? action.jobId;
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
 * JSON-value equality independent of object key order. Postgres jsonb returns
 * keys in length-then-bytewise order while candidates build insertion-ordered
 * literals, so a raw JSON.stringify comparison re-patched identical
 * triggerValues on every run — breaking the two-identical-runs-produce-zero-
 * changes invariant and churning updatedAt/updatedBy.
 */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => jsonEquals(value, b[index]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    jsonEquals(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key]
    )
  );
}

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

const MEMBER_TRANSFER_REASON = "Sibling stock not needed within the horizon";
const MEMBER_BORROW_REASON = "Sibling stock lent until the sibling needs it";

/** The pure pegging functions `memberMoveCandidates` uses (`@carbon/ee/pegging`). */
export type MemberMovePegging = {
  proposeMemberMoves: (args: {
    members: MemberPosition[];
    horizonEndDate: string;
    leadTimeDays: number;
    today: string;
    priorityRule?: PegPriorityRule;
  }) => MemberMove[];
  memberPositionsOf: (
    input: GroupPegInput,
    memberProjectIds: readonly string[],
    priorityByProject: Readonly<Record<string, number>>
  ) => MemberPosition[];
  applyMemberMoves: (
    input: GroupPegInput,
    moves: readonly MemberMove[],
    today: string
  ) => GroupPegInput;
};

/**
 * Projects Phase 3: the member Transfers and Borrows of every planning group.
 * Per (group, item, location) peg input, `proposeMemberMoves` moves stock
 * from a sibling with excess to a short member. Each move is a candidate in
 * the group's segment; moves with one natural key add up. The returned peg
 * inputs carry the moved stock, so the short member's own stock covers its
 * demand before pegging. A move never changes the group's net requirement.
 */
export function memberMoveCandidates(
  args: {
    inputs: GroupPegInput[];
    planningGroups: { id: string; memberProjectIds: string[] }[];
    priorityRuleByGroup: Record<string, PegPriorityRule>;
    priorityByProject: Record<string, number>;
    /** `itemId + KEY_SEP + locationId` -> the item's lead time in days. */
    leadTimeByItemLocation: ReadonlyMap<string, number>;
    periods: { id: string; startDate: string }[];
    todayDate: string;
    assigneeOf: (
      itemId: string,
      locationId: string,
      segmentId: string
    ) => string | null;
  },
  pegging: MemberMovePegging
): { candidates: PlanningActionCandidate[]; inputs: GroupPegInput[] } {
  const { periods, todayDate } = args;
  const lastPeriod = periods[periods.length - 1];
  if (!lastPeriod) return { candidates: [], inputs: args.inputs };
  const horizonEndDate = parseDate(lastPeriod.startDate)
    .add({ days: DAYS_PER_PERIOD - 1 })
    .toString();
  const membersByGroup = new Map(
    args.planningGroups.map((group) => [group.id, group.memberProjectIds])
  );
  const periodFor = (dateIso: string) => {
    let match = periods[0]!;
    for (const p of periods) {
      if (daysBetween(p.startDate, dateIso) <= 0) match = p;
      else break;
    }
    return match;
  };

  const byKey = new Map<string, PlanningActionCandidate>();
  const inputs = args.inputs.map((input) => {
    const memberIds = membersByGroup.get(input.planningGroupId) ?? [];
    if (memberIds.length < 2) return input;
    const moves = pegging.proposeMemberMoves({
      members: pegging.memberPositionsOf(
        input,
        memberIds,
        args.priorityByProject
      ),
      horizonEndDate,
      leadTimeDays:
        args.leadTimeByItemLocation.get(
          input.itemId + KEY_SEP + input.locationId
        ) ?? 0,
      today: todayDate,
      priorityRule: args.priorityRuleByGroup[input.planningGroupId]
    });
    for (const move of moves) {
      const date = laterDate(move.needDate, todayDate);
      const candidate: PlanningActionCandidate = {
        itemId: input.itemId,
        locationId: input.locationId,
        periodId: periodFor(date).id,
        type: move.type,
        suggestedQuantity: move.quantity,
        suggestedDate: date,
        horizonDate: date,
        latestOrderDate: null,
        isASAP: daysBetween(move.needDate, todayDate) <= 0,
        purchaseOrderLineId: null,
        jobId: null,
        requiresManualAction: false,
        supplierId: null,
        policyName: null,
        reason:
          move.type === "Borrow"
            ? MEMBER_BORROW_REASON
            : MEMBER_TRANSFER_REASON,
        triggerValues: move.paybackDueDate
          ? { paybackDueDate: move.paybackDueDate }
          : null,
        assignee: args.assigneeOf(
          input.itemId,
          input.locationId,
          input.planningGroupId
        ),
        planningSegmentId: input.planningGroupId,
        fromProjectId: move.fromProjectId,
        toProjectId: move.toProjectId
      };
      const key = naturalKey(candidate);
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, candidate);
        continue;
      }
      current.suggestedQuantity = round(
        current.suggestedQuantity + candidate.suggestedQuantity
      );
      current.isASAP = current.isASAP || candidate.isASAP;
      // the earliest payback of the moves it holds
      const payback = candidate.triggerValues?.paybackDueDate;
      const held = current.triggerValues?.paybackDueDate;
      if (
        typeof payback === "string" &&
        typeof held === "string" &&
        payback < held
      ) {
        current.triggerValues = { paybackDueDate: payback };
      }
    }
    return pegging.applyMemberMoves(input, moves, todayDate);
  });
  return { candidates: [...byKey.values()], inputs };
}

// ──────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────

type RpcPlanningRow =
  Database["public"]["Functions"]["get_purchasing_planning"]["Returns"][number];
type ProductionPlanningRow =
  Database["public"]["Functions"]["get_production_planning"]["Returns"][number];

/** The map key of an item at a location in one netting segment. */
export function itemLocationSegmentKey(
  itemId: string,
  locationId: string,
  segmentId: string = COMMON_SEGMENT
): string {
  return itemId + KEY_SEP + locationId + KEY_SEP + segmentId;
}

/**
 * On-hand per item, location and netting segment (`itemLocationSegmentKey`).
 * itemStockQuantities holds one row per project stock stripe ('' is common).
 * Each stripe sums into its segment by the rule of the SQL
 * `project_planning_segment` (`planningSegmentOf`): a project with project
 * stock is its own segment, any other stripe is common.
 */
export async function loadSegmentOnHand(
  db: Kysely<DB>,
  companyId: string,
  // Projects Phase 3: project id -> its active planning group, when the
  // company has PLANNING_GROUPS. A member's stock is its group's.
  groupByProject?: ReadonlyMap<string, string>
): Promise<Map<string, number>> {
  const [rows, stockedProjects] = await Promise.all([
    // Nettable on-hand, the figure runMrp plans against.
    db
      .selectFrom("itemStockQuantities")
      .select((eb) => [
        "itemId",
        "locationId",
        "projectId",
        eb("quantityOnHand", "-", eb.ref("quantityNonNettable")).as(
          "quantityOnHand"
        )
      ])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("project")
      .select(["id"])
      .where("companyId", "=", companyId)
      .where("projectStock", "=", true)
      .execute()
  ]);
  const stockedProjectIds = new Set(stockedProjects.map((p) => p.id));
  const onHand = new Map<string, number>();
  for (const row of rows) {
    if (!row.itemId || !row.locationId) continue;
    const key = itemLocationSegmentKey(
      row.itemId,
      row.locationId,
      planningSegmentOf(row.projectId, stockedProjectIds, groupByProject)
    );
    onHand.set(key, (onHand.get(key) ?? 0) + (Number(row.quantityOnHand) || 0));
  }
  return onHand;
}

/** What one project segment takes from common stock in one period. */
export type CommonSurplusDraw = {
  itemId: string;
  locationId: string;
  periodId: string;
  planningSegmentId: string;
  quantity: number;
};

const TRANSFER_REASON = "Common stock not needed within the horizon";

export type DeriveRowActionsInput = {
  /** One planning RPC row: one item in one segment at the location. */
  row: RpcPlanningRow | ProductionPlanningRow;
  kind: "Order" | "Make";
  /** This run's weeks, current first. */
  periods: { id: string; startDate: string }[];
  /** Demand of the item in the row's segment, by period id. */
  demandByPeriod: Map<string, number>;
  /** Open PO lines or jobs of the item in the row's segment. */
  openOrders: OpenSupplyOrder[];
  /** On-hand of the item in the row's segment. */
  onHand: number;
  /** What the row's segment takes from common stock, per period. */
  draws: { periodId: string; quantity: number }[];
  toleranceDays: number;
  todayDate: string;
};

/**
 * Every action for one planning row: the change actions on its open orders,
 * the new supply its projection needs, the releases of its planned orders,
 * and, in a project segment, a Transfer per period that draws common stock.
 *
 * A project segment is lot-for-lot: no reorder point, safety stock or Stock
 * Only reserve. A draw counts as the segment's own stock from its period on,
 * so the segment's Order or Make covers only the remainder.
 *
 * An open Project Borrow is firm: MRP books it as demand on the borrower and
 * supply on the lender, in the row's projection, but it is never one of
 * `openOrders`, so no change action (Expedite, Defer, Cancel, Increase,
 * Decrease) ever targets it. An overdue borrow is an exception the planning
 * worklist and the project header show instead.
 */
export function deriveRowActions(
  input: DeriveRowActionsInput
): ChangeCandidate[] {
  const {
    row,
    kind,
    periods,
    demandByPeriod,
    openOrders,
    toleranceDays,
    todayDate
  } = input;
  const segmentId = row.planningSegmentId || COMMON_SEGMENT;
  const isProjectSegment = segmentId !== COMMON_SEGMENT;

  const drawByPeriod = drawsByPeriod(isProjectSegment ? input.draws : []);

  const { changeActions, newSupply: merged } = sizeRowSupply({
    kind,
    isProjectSegment,
    supersessionMode: row.supersessionMode,
    quantityToOrder: row.quantityToOrder,
    minimumReserveQuantity: row.minimumReserveQuantity,
    quantityOnHand: row.quantityOnHand,
    onHand: input.onHand,
    draws: input.draws,
    periods,
    projections: periods.map(
      (_, i) => Number(row[`week${i + 1}` as keyof typeof row]) || 0
    ),
    demandByPeriod,
    openOrders,
    policy: row,
    preferredSupplierId: (row as RpcPlanningRow).preferredSupplierId ?? null,
    toleranceDays,
    todayDate
  });

  // Lot-size splitting can emit several new-supply suggestions in one
  // period; persist ONE action per (type, period) with the summed quantity
  // — the natural key would otherwise collide and silently drop batches.
  // The planning pages split the action back into the orders its policy
  // sized (`splitIntoOrders`): a batch, a fixed reorder quantity, a
  // maximum order quantity each.
  const aggregated = new Map<string, ChangeCandidate>();
  const passthrough: ChangeCandidate[] = [];
  for (const candidate of merged) {
    const isNewSupply =
      (candidate.type === "Order" || candidate.type === "Make") &&
      !candidate.purchaseOrderLineId &&
      !candidate.jobId;
    if (!isNewSupply) {
      passthrough.push(candidate);
      continue;
    }
    const key = `${candidate.type}${KEY_SEP}${candidate.periodId}`;
    const current = aggregated.get(key);
    if (current) {
      current.suggestedQuantity += candidate.suggestedQuantity;
      current.isASAP = current.isASAP || candidate.isASAP;
      current.suggestedDate = earlierDate(
        current.suggestedDate,
        candidate.suggestedDate
      );
      current.horizonDate = earlierDate(
        current.horizonDate,
        candidate.horizonDate
      );
      if (candidate.latestOrderDate) {
        current.latestOrderDate = current.latestOrderDate
          ? earlierDate(current.latestOrderDate, candidate.latestOrderDate)
          : candidate.latestOrderDate;
      }
    } else {
      aggregated.set(key, { ...candidate });
    }
  }

  const releaseActions = deriveReleaseActions({
    openOrders,
    changeActions,
    periods,
    todayDate
  });

  // One Transfer per period a draw lands in: common stock into the project.
  const transfers: ChangeCandidate[] = [];
  for (const period of periods) {
    const quantity = drawByPeriod.get(period.id) ?? 0;
    if (quantity <= 0) continue;
    transfers.push({
      type: "Transfer",
      periodId: period.id,
      suggestedQuantity: quantity,
      suggestedDate: period.startDate,
      horizonDate: period.startDate,
      latestOrderDate: null,
      isASAP: daysBetween(period.startDate, todayDate) < 0,
      purchaseOrderLineId: null,
      jobId: null,
      requiresManualAction: false,
      supplierId: null,
      policyName: null,
      reason: TRANSFER_REASON,
      triggerValues: null,
      fromProjectId: null,
      toProjectId: segmentId
    });
  }

  return [
    ...aggregated.values(),
    ...passthrough,
    ...changeActions,
    ...releaseActions,
    ...transfers
  ].map((action) => ({ ...action, planningSegmentId: segmentId }));
}

export async function generatePlanningActions(
  client: SupabaseClient<Database>,
  db: Kysely<DB>,
  args: {
    companyId: string;
    userId: string;
    /**
     * What each project segment takes from common stock (`planCompany`'s
     * `commonSurplusDraws`). Each draw becomes a Transfer action.
     */
    commonSurplusDraws?: CommonSurplusDraw[];
    /**
     * Projects Phase 3: the active planning groups and their members, as
     * `runMrp` passed them to `planCompany` (empty without PLANNING_GROUPS).
     */
    planningGroups?: { id: string; memberProjectIds: string[] }[];
    /**
     * Projects Phase 3: the peg writer's inputs, passed only when the company
     * has PLANNING_GROUPS. The pegs are diff-written in this function's
     * transaction, after the actions, so a planned supply has its action id.
     * `writeGroupPegs` is the commercial writer, injected by the server-side
     * caller (`MrpDeps`): this package imports no `.server` module.
     */
    pegging?: {
      writeGroupPegs: WriteGroupPegs;
      runId: string;
      inputs: GroupPegInput[];
      priorityRuleByGroup: Record<string, PegPriorityRule>;
      priorityByProject: Record<string, number>;
    };
  }
): Promise<{ inserted: number; updated: number; deleted: number }> {
  const { companyId, userId } = args;

  const timeZone = await getCompanyTimeZone(db, companyId);
  const todayDate = datetime.today(timeZone).toString();
  const weekStart = startOfWeek(datetime.today(timeZone), "en-US").toString();

  const [settings, locations, periodRows] = await Promise.all([
    db
      .selectFrom("companySettings")
      .select(["rescheduleToleranceDays"])
      .where("id", "=", companyId)
      .executeTakeFirst(),
    db
      .selectFrom("location")
      .select(["id"])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("period")
      .select(["id", "startDate"])
      .where("periodType", "=", "Week")
      .where("startDate", ">=", weekStart)
      .orderBy("startDate", "asc")
      .limit(WEEKS_TO_PLAN)
      .execute()
  ]);

  const toleranceDays = Number(settings?.rescheduleToleranceDays ?? 7);
  const periods = periodRows.map((p) => ({
    id: p.id,
    startDate: toIsoDate(p.startDate as unknown as string | Date)!
  }));
  const periodIds = periods.map((p) => p.id);
  const periodIdSet = new Set(periodIds);
  const periodById = new Map(periods.map((p) => [p.id, p]));

  if (periods.length === 0 || locations.length === 0) {
    return { inserted: 0, updated: 0, deleted: 0 };
  }

  // Every read below is independent of the others, so they run together in
  // two groups instead of one after another (they were six waits in a row).
  // Two groups, not one: the resolver alone takes five Kysely reads from the
  // shared process pool, so a bounded group leaves connections for the run's
  // other work — the PostgREST views ride alongside it.
  const [resolveAssignee, openPoLines, openJobs] = await Promise.all([
    loadResponsibleEmployeeResolver(db, companyId),
    // ── open supply (real documents change actions target)
    fetchAll<Database["public"]["Views"]["openPurchaseOrderLines"]["Row"]>(() =>
      client
        .from("openPurchaseOrderLines")
        .select("*")
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAll<Database["public"]["Views"]["openProductionOrders"]["Row"]>(() =>
      client
        .from("openProductionOrders")
        .select("*")
        .eq("companyId", companyId)
        .order("id")
    )
  ]);
  if (openPoLines.error) throw openPoLines.error;
  if (openJobs.error) throw openJobs.error;
  const poLineRows = openPoLines.data ?? [];
  const jobRows = openJobs.data ?? [];

  // ── demand per (item, location, segment, period): actual + forecast +
  //    projection (net of consumption), the same union the planning RPCs
  //    read; on-hand per segment; the open jobs' status and good-unit
  //    quantity, and the open PO lines' conversion factor, which the
  //    openProductionOrders / openPurchaseOrderLines views do not expose —
  //    one read each of the company's open documents (the views' own
  //    filters), no id list. Projections are common demand.
  const [
    demandActuals,
    demandForecasts,
    demandProjections,
    onHandByItemLocation,
    openJobRows,
    poLineFactorRows
  ] = await Promise.all([
    db
      .selectFrom("demandActual")
      .select([
        "itemId",
        "locationId",
        "periodId",
        "planningSegmentId",
        "actualQuantity"
      ])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("demandForecast")
      .select([
        "itemId",
        "locationId",
        "periodId",
        "planningSegmentId",
        "forecastQuantity"
      ])
      .where("companyId", "=", companyId)
      .execute(),
    db
      .selectFrom("demandProjection")
      .select([
        "itemId",
        "locationId",
        "periodId",
        "forecastQuantity",
        "consumedQuantity"
      ])
      .where("companyId", "=", companyId)
      .execute(),
    loadSegmentOnHand(db, companyId, groupByProjectOf(args.planningGroups)),
    db
      .selectFrom("job")
      .select(["id", "status", "quantity", "quantityReceivedToInventory"])
      .where("companyId", "=", companyId)
      .where("status", "in", ["Planned", "Ready", "In Progress", "Paused"])
      .execute(),
    // Only the lines bought in a unit other than the inventory unit: every
    // other line's factor is 1, the default below.
    db
      .selectFrom("purchaseOrderLine as pol")
      .innerJoin("purchaseOrder as po", "po.id", "pol.purchaseOrderId")
      .select(["pol.id", "pol.conversionFactor"])
      .where("pol.companyId", "=", companyId)
      .where("po.status", "in", [
        "To Receive",
        "To Receive and Invoice",
        "Planned"
      ])
      .where("pol.receivedComplete", "=", false)
      .where("pol.conversionFactor", "!=", 1)
      .execute()
  ]);

  const demandByItemLocation = new Map<string, Map<string, number>>();
  const addDemand = (
    itemId: string | null,
    locationId: string | null,
    segmentId: string | null,
    periodId: string | null,
    quantity: number | null
  ) => {
    if (!itemId || !locationId || !periodId) return;
    if (!periodIdSet.has(periodId)) return;
    const key = itemLocationSegmentKey(
      itemId,
      locationId,
      segmentId || COMMON_SEGMENT
    );
    const byPeriod = demandByItemLocation.get(key) ?? new Map<string, number>();
    byPeriod.set(
      periodId,
      (byPeriod.get(periodId) ?? 0) + (Number(quantity) || 0)
    );
    demandByItemLocation.set(key, byPeriod);
  };
  for (const row of demandActuals) {
    addDemand(
      row.itemId,
      row.locationId,
      row.planningSegmentId,
      row.periodId,
      row.actualQuantity
    );
  }
  for (const row of demandForecasts) {
    addDemand(
      row.itemId,
      row.locationId,
      row.planningSegmentId,
      row.periodId,
      row.forecastQuantity
    );
  }
  for (const row of demandProjections) {
    addDemand(
      row.itemId,
      row.locationId,
      COMMON_SEGMENT,
      row.periodId,
      Math.max(
        (Number(row.forecastQuantity) || 0) -
          (Number(row.consumedQuantity) || 0),
        0
      )
    );
  }

  const jobById = new Map<
    string,
    {
      status: Database["public"]["Enums"]["jobStatus"];
      quantity: number;
      quantityReceivedToInventory: number;
    }
  >();
  for (const row of openJobRows) {
    if (!row.status) continue;
    jobById.set(row.id, {
      status: row.status,
      quantity: Number(row.quantity) || 0,
      quantityReceivedToInventory: Number(row.quantityReceivedToInventory) || 0
    });
  }

  const conversionFactorByLineId = new Map(
    poLineFactorRows.map((row) => [row.id, Number(row.conversionFactor)])
  );

  const openOrdersByItemLocation = new Map<string, OpenSupplyOrder[]>();
  const pushOrder = (key: string, order: OpenSupplyOrder) => {
    const list = openOrdersByItemLocation.get(key) ?? [];
    list.push(order);
    openOrdersByItemLocation.set(key, list);
  };
  // A Planned purchase order is released once, for whichever of its lines
  // needs it first — every line's Release carries that date.
  const releaseByPurchaseOrder = new Map<string, PlannedOrderRelease>();
  for (const line of poLineRows) {
    if (line.status !== "Planned" || !line.purchaseOrderId) continue;
    if ((Number(line.quantityToReceive) || 0) <= 0) continue;
    const dueDate = purchaseOrderLineArrivalDate(line, todayDate);
    const leadTime = Number(line.leadTime) || 0;
    releaseByPurchaseOrder.set(
      line.purchaseOrderId,
      earlierRelease(releaseByPurchaseOrder.get(line.purchaseOrderId), {
        date: releaseByDate(dueDate, leadTime),
        dueDate,
        leadTime
      })
    );
  }

  for (const line of poLineRows) {
    if (!line.id || !line.itemId || !line.locationId) continue;
    const quantity = Number(line.quantityToReceive) || 0;
    if (quantity <= 0) continue;
    // the same arrival date the projection buckets this line on
    const dueDate = purchaseOrderLineArrivalDate(line, todayDate);
    pushOrder(
      itemLocationSegmentKey(
        line.itemId,
        line.locationId,
        line.planningSegmentId || COMMON_SEGMENT
      ),
      {
        purchaseOrderLineId: line.id,
        quantity,
        dueDate,
        requiresManualAction: isCommittedPurchaseOrderStatus(line.status),
        dateIsPromised: Boolean(line.promisedDate),
        supplierId: line.supplierId,
        conversionFactor: conversionFactorByLineId.get(line.id) ?? 1,
        release:
          line.status === "Planned" && line.purchaseOrderId
            ? (releaseByPurchaseOrder.get(line.purchaseOrderId) ?? null)
            : null
      }
    );
  }
  for (const job of jobRows) {
    if (!job.id || !job.itemId || !job.locationId) continue;
    const details = jobById.get(job.id);
    // The view's quantityToReceive is productionQuantity (quantity + scrap)
    // less received. A change action is applied to `job.quantity`, the good
    // units, so the order is measured in those: on the view's figure every
    // job with a scrap allowance read as over-supplied, got a Decrease to its
    // own quantity, and got it again after it was applied.
    const quantity = details
      ? Math.max(details.quantity - details.quantityReceivedToInventory, 0)
      : Number(job.quantityToReceive) || 0;
    if (quantity <= 0) continue;
    // the same date the projection buckets this job on — an undated job is
    // supply there, so it is supply here too
    const dueDate = jobCompletionDate(job, todayDate);
    const leadTime = Number(job.leadTime) || 0;
    pushOrder(
      itemLocationSegmentKey(
        job.itemId,
        job.locationId,
        job.planningSegmentId || COMMON_SEGMENT
      ),
      {
        jobId: job.id,
        quantity,
        dueDate,
        requiresManualAction: isCommittedJobStatus(details?.status),
        release:
          details?.status === "Planned"
            ? { date: releaseByDate(dueDate, leadTime), dueDate, leadTime }
            : null
      }
    );
  }

  // ── the common stock each project segment draws, per item and location
  const drawsByItemLocation = new Map<
    string,
    { periodId: string; quantity: number }[]
  >();
  for (const draw of args.commonSurplusDraws ?? []) {
    if (!draw.planningSegmentId || draw.quantity <= 0) continue;
    const key = itemLocationSegmentKey(
      draw.itemId,
      draw.locationId,
      draw.planningSegmentId
    );
    const list = drawsByItemLocation.get(key) ?? [];
    list.push({ periodId: draw.periodId, quantity: draw.quantity });
    drawsByItemLocation.set(key, list);
  }

  // ── planning rows (projections + reorder params) per location and segment
  const candidates: PlanningActionCandidate[] = [];
  // The lead time of each item at each location, for the member Borrows.
  const leadTimeByItemLocation = new Map<string, number>();

  for (const location of locations) {
    // Paged like every other read in the run: a bare RPC call stops at
    // PostgREST's max_rows, and an item missing from these rows has no
    // candidates — the diff below would then DELETE its existing actions,
    // dismissals and assignee overrides included. A row is one item in one
    // segment, so the pages order by the item id, then the segment: a total
    // order, so the pages neither overlap nor skip.
    const [purchasing, production] = await Promise.all([
      fetchAll<RpcPlanningRow>(() =>
        client
          .rpc("get_purchasing_planning", {
            company_id: companyId,
            location_id: location.id,
            periods: periodIds
          })
          .order("id")
          .order("planningSegmentId")
      ),
      fetchAll<ProductionPlanningRow>(() =>
        client
          .rpc("get_production_planning", {
            company_id: companyId,
            location_id: location.id,
            periods: periodIds
          })
          .order("id")
          .order("planningSegmentId")
      )
    ]);
    if (purchasing.error) throw new Error(purchasing.error.message);
    if (production.error) throw new Error(production.error.message);

    const process = (
      row: RpcPlanningRow | ProductionPlanningRow,
      kind: "Order" | "Make"
    ) => {
      const key = itemLocationSegmentKey(
        row.id,
        location.id,
        row.planningSegmentId || COMMON_SEGMENT
      );
      const actions = deriveRowActions({
        row,
        kind,
        periods,
        demandByPeriod:
          demandByItemLocation.get(key) ?? new Map<string, number>(),
        openOrders: openOrdersByItemLocation.get(key) ?? [],
        onHand: onHandByItemLocation.get(key) ?? 0,
        draws: drawsByItemLocation.get(key) ?? [],
        toleranceDays,
        todayDate
      });

      leadTimeByItemLocation.set(
        row.id + KEY_SEP + location.id,
        Number(row.leadTime) || 0
      );
      const assignee = resolveAssignee(
        row.id,
        location.id,
        row.planningSegmentId || COMMON_SEGMENT
      );
      for (const action of actions) {
        if (!action.periodId || !periodById.has(action.periodId)) continue;
        candidates.push({
          ...action,
          // Persist boundary: every source above is float arithmetic.
          suggestedQuantity: round(action.suggestedQuantity),
          itemId: row.id,
          locationId: location.id,
          assignee
        });
      }
    };

    for (const row of purchasing.data ?? []) process(row, "Order");
    for (const row of production.data ?? []) process(row, "Make");
  }

  // ── Projects Phase 3: member Transfers and Borrows inside each planning
  // group. Only with PLANNING_GROUPS (`args.pegging`); the commercial
  // functions load lazily, so a company without the feature loads none.
  let pegging = args.pegging;
  if (pegging && (args.planningGroups ?? []).length > 0) {
    const moves = memberMoveCandidates(
      {
        inputs: pegging.inputs,
        planningGroups: args.planningGroups ?? [],
        priorityRuleByGroup: pegging.priorityRuleByGroup,
        priorityByProject: pegging.priorityByProject,
        leadTimeByItemLocation,
        periods,
        todayDate,
        assigneeOf: resolveAssignee
      },
      await import("@carbon/ee/pegging")
    );
    candidates.push(...moves.candidates);
    pegging = { ...pegging, inputs: moves.inputs };
  }

  // ── diff-write. One transaction holds a per-company advisory lock across
  // the read and the write: two runs for one company can overlap (the cron
  // racing a route-triggered run), and both reading "no row" for a natural
  // key then inserting fails the second on planningAction_natural_key_idx —
  // which rolls back the whole write. Under the lock the second run reads
  // the first run's rows and updates them in place instead.
  const diff = await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`planning-actions:${companyId}`}, 0))`.execute(
      trx
    );

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
      candidates,
      periods,
      toleranceDays
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
        candidates,
        keyPeriod: keyPeriodFor(periods)
      });
      logger.info("project pegs written", { companyId, ...pegs });
    }

    return diff;
  });

  logger.info("planning actions written", {
    companyId,
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    deleted: diff.deleteIds.length
  });

  return {
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    deleted: diff.deleteIds.length
  };
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
    pegging: NonNullable<
      Parameters<typeof generatePlanningActions>[2]["pegging"]
    >;
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
