// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The one owner of the rule: on a later operation of a serial part, a write
// names a unit the operator picked or scanned. The server cannot tell a pick
// from an echoed id, so it checks what it can (the unit is this operation's
// and open here) and never picks a unit itself on a later operation. Every
// MES write of a unit goes through `resolveWorkUnit` (the
// `mes-unit-write-resolves-unit` check in @carbon/checks), and so does the
// ERP's timer Start (`startOperationTimer`, `./timer`). The MES imports it
// through `apps/mes/app/services/work-unit.server.ts`.
//
// A unit on hold for an open quality issue (`readUnitHolds`) is not open
// here: no write that needs an open unit names it, and none takes it as the
// next unit or the one left. A `member` write still names it; that is how
// quality acts on it.

import type { Database } from "@carbon/database";
import { fetchAll } from "@carbon/database/fetch-all";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSerialEntityIncompleteForOperation,
  operationUnits,
  type SerialEntityForSelection
} from "./shop-floor";
import { isUnitOnHold, type UnitHolds, unitOnHoldMessage } from "./unit-hold";
import { readUnitHolds } from "./unit-hold-read";

const log = getLogger("lib", "work-unit");

type Client = SupabaseClient<Database>;

/** The one answer when a write on a serial part names no unit. */
export const SELECT_UNIT_FIRST = "Select a unit first";
const UNIT_CHECK_FAILED = "Could not check this unit. Try again.";
const NOT_THIS_JOB = "This unit is not part of this job";
const NOT_THIS_OPERATION = "This unit is not worked at this operation";
const DONE_HERE = "This unit is already complete at this operation";
const ALL_DONE = "Every unit is complete at this operation";
const ONLY_ON_HOLD = "Every unit left at this operation is on hold";

/**
 * How a write may come to its unit.
 * - `advance`: the kanban complete scan. With none named, the first
 *   operation takes the next open unit (units flow in order through it).
 * - `start`: the kanban start scan. As `advance`, but with none named a
 *   later operation with several open units starts with no unit, like the
 *   in-app Start; the screen then asks for the unit.
 * - `require`: the write needs an open unit here (complete, scrap, rework,
 *   step record, issue).
 * - `optional`: a named unit open here is stamped (a timer start). With none
 *   named, or one done here or outside the operation, the first operation
 *   takes the next open unit and a later operation stamps none.
 * - `member`: a named unit must be this operation's; it may be done here
 *   (a quality issue, a correction, a subcomponent scrap) or on hold.
 * - `claim`: the server proposes the unit (a traveler claim). On a later
 *   operation it must be `heldUnitId` or the one open unit.
 *
 * Every mode takes the one open unit when none is named, except `member`,
 * which then names none, and `optional` (above).
 */
export type WorkUnitMode =
  | "advance"
  | "start"
  | "require"
  | "optional"
  | "member"
  | "claim";

export type WorkUnit =
  /**
   * No serial unit. `lotId` (not serial): the lot an `advance` write takes,
   * or the id an `optional` write named, passed through.
   */
  | { kind: "none"; lotId?: string }
  | {
      kind: "unit";
      unitId: string;
      /** The unit's place in the make method's unit axis (step record key). */
      unitIndex: number;
      isFirstOperation: boolean;
      via: "named" | "advanced" | "sole";
    }
  /** `pickUnit`: the screen asks the operator for the unit. */
  | { kind: "refuse"; pickUnit: boolean; message: string };

export type OperationUnitFacts = {
  jobId: string;
  jobMakeMethodId: string | null;
  serial: boolean;
  batch: boolean;
  /** No operation of the same make method comes before it. */
  isFirstOperation: boolean;
  /** Caps the units the operation works, as on the operation screens. */
  operationQuantity: number | null;
};

type Unit = SerialEntityForSelection & { id: string };

/**
 * Whether each operation's part is serial and whether it is the first
 * operation of its make method, in one read. Null when the read fails: the
 * caller refuses rather than reads "first".
 */
export async function readOperationUnitFacts(
  client: Client,
  args: { companyId: string; operationIds: string[] }
): Promise<Map<string, OperationUnitFacts> | null> {
  const ids = [...new Set(args.operationIds)];
  if (ids.length === 0) return new Map();
  const read = await client
    .from("jobOperation")
    .select(
      "id, jobId, jobMakeMethodId, operationQuantity, jobMakeMethod(requiresSerialTracking, requiresBatchTracking), priors:jobOperationDependency!jobOperationDependency_operationId_fk(dependsOn:jobOperation!jobOperationDependency_dependsOnId_fk(jobMakeMethodId))"
    )
    .in("id", ids)
    .eq("companyId", args.companyId);
  if (read.error) {
    log.error("Could not read the operations' unit rules", {
      companyId: args.companyId,
      error: read.error
    });
    return null;
  }
  return new Map(
    (read.data ?? []).map((row) => [
      row.id,
      {
        jobId: row.jobId,
        jobMakeMethodId: row.jobMakeMethodId,
        serial: !!row.jobMakeMethod?.requiresSerialTracking,
        batch: !!row.jobMakeMethod?.requiresBatchTracking,
        operationQuantity: row.operationQuantity,
        isFirstOperation: !(row.priors ?? []).some(
          (prior) =>
            !!row.jobMakeMethodId &&
            prior.dependsOn?.jobMakeMethodId === row.jobMakeMethodId
        )
      }
    ])
  );
}

/**
 * Is this the first operation of its make method's routing? Only a dependency
 * on an operation of the same make method counts; a subassembly finishing
 * first does not. A failed read is "not first": no auto-advance, no label.
 */
export async function isFirstOperationOfMakeMethod(
  client: Client,
  args: { companyId: string; operationId: string }
): Promise<boolean> {
  const facts = await readOperationUnitFacts(client, {
    companyId: args.companyId,
    operationIds: [args.operationId]
  });
  return facts?.get(args.operationId)?.isFirstOperation ?? false;
}

const TERMINAL = new Set(["Consumed", "Scrapped"]);

const refuse = (pickUnit: boolean, message: string): WorkUnit => ({
  kind: "refuse",
  pickUnit,
  message
});

/** The rule, from what the database says. Pure: tested by value. */
export function decideWorkUnit({
  facts,
  units,
  operationId,
  requestedUnitId,
  mode,
  heldUnitId = null,
  legacyUnitIndex,
  onHold = {}
}: {
  facts: OperationUnitFacts;
  /** The make method's units in axis order, flagged with operation scope. */
  units: Unit[];
  operationId: string;
  requestedUnitId: string | null | undefined;
  mode: WorkUnitMode;
  heldUnitId?: string | null;
  /**
   * A step record from a tablet that sends no unit: the axis place it shows.
   * Read on a first operation only, where units flow in order.
   */
  legacyUnitIndex?: number;
  /** The open issues that hold a unit (`readUnitHolds`); serial units only. */
  onHold?: UnitHolds;
}): WorkUnit {
  const isIncomplete = (unit: Unit) =>
    isSerialEntityIncompleteForOperation(unit, operationId);
  // Work waits on a unit on hold, so it is never the next unit or the one left.
  const isOpen = (unit: Unit) =>
    isIncomplete(unit) && !isUnitOnHold(onHold, unit.id);

  if (!facts.serial) {
    if (mode === "optional") {
      return requestedUnitId
        ? { kind: "none", lotId: requestedUnitId }
        : { kind: "none" };
    }
    if (!facts.batch || (mode !== "advance" && mode !== "start")) {
      return { kind: "none" };
    }
    // The lot: the first live one still open here, else the last one.
    const live = units.filter(
      (unit) =>
        unit.inOperationScope !== false && !TERMINAL.has(unit.status ?? "")
    );
    const lotId =
      requestedUnitId ??
      (
        live.find(isIncomplete) ??
        live[live.length - 1] ??
        units[units.length - 1]
      )?.id;
    return lotId ? { kind: "none", lotId } : { kind: "none" };
  }

  const { isFirstOperation } = facts;
  // The units the operation works, as the screens list them (scope, then
  // quantity). A named unit is checked against the whole axis.
  const worked = operationUnits(units, facts.operationQuantity, {
    operationId,
    holds: onHold
  });
  const open = worked.filter(isOpen);
  const sole = open.length === 1 ? open[0] : undefined;
  const take = (unit: Unit, via: "named" | "advanced" | "sole"): WorkUnit => ({
    kind: "unit",
    unitId: unit.id,
    unitIndex: units.findIndex((u) => u.id === unit.id),
    isFirstOperation,
    via
  });

  // A timer on a first operation runs on the next open unit, as units flow
  // in order; on a later operation it names none rather than guess.
  const timerUnit = (): WorkUnit =>
    isFirstOperation && open[0] ? take(open[0], "advanced") : { kind: "none" };

  const requested =
    requestedUnitId ??
    (isFirstOperation && legacyUnitIndex !== undefined
      ? units[legacyUnitIndex]?.id
      : undefined);

  if (requested) {
    const named = units.find((unit) => unit.id === requested);
    if (!named) return refuse(true, NOT_THIS_JOB);
    // A timer names a unit only to stamp it: one not open here is dropped.
    if (mode === "optional" && !isOpen(named)) return timerUnit();
    if (named.inOperationScope === false)
      return refuse(true, NOT_THIS_OPERATION);
    // A unit done here answers "already complete", on hold or not.
    if (mode !== "member" && isIncomplete(named) && !isOpen(named)) {
      return refuse(true, unitOnHoldMessage(onHold[named.id] ?? []));
    }
    if (
      mode === "claim" &&
      !isFirstOperation &&
      named.id !== heldUnitId &&
      named.id !== sole?.id
    ) {
      return refuse(true, SELECT_UNIT_FIRST);
    }
    if (mode !== "member" && !isOpen(named)) {
      return refuse(true, DONE_HERE);
    }
    // A released serial can move outside the working set after its replacement
    // completed the last outstanding unit. A stale scan must not reopen it.
    if (mode !== "member" && !worked.includes(named) && open.length === 0) {
      return mode === "optional" ? timerUnit() : refuse(false, ALL_DONE);
    }
    return take(named, "named");
  }

  if (mode === "member") return { kind: "none" };
  if (mode === "optional") return timerUnit();
  const next = open[0];
  if ((mode === "advance" || mode === "start") && isFirstOperation && next) {
    return take(next, "advanced");
  }
  if (sole) return take(sole, "sole");
  if (open.length === 0) {
    return refuse(false, worked.some(isIncomplete) ? ONLY_ON_HOLD : ALL_DONE);
  }
  if (mode === "start") return { kind: "none" };
  return refuse(true, SELECT_UNIT_FIRST);
}

/**
 * The unit a write at an operation works on, or why it may not run. Call it
 * before any write and write only the unit it returns. Company-scoped: an
 * operation of another company is "not found".
 */
export async function resolveWorkUnit({
  client,
  companyId,
  operationId,
  requestedUnitId,
  mode,
  heldUnitId,
  legacyUnitIndex
}: {
  client: Client;
  companyId: string;
  operationId: string;
  requestedUnitId?: string | null;
  mode: WorkUnitMode;
  /** `claim` only: the unit on the operator's screen. */
  heldUnitId?: string | null;
  /** See `decideWorkUnit`. */
  legacyUnitIndex?: number;
}): Promise<WorkUnit> {
  const read = await readOperationUnitFacts(client, {
    companyId,
    operationIds: [operationId]
  });
  if (!read) return refuse(false, UNIT_CHECK_FAILED);
  const facts = read.get(operationId);
  if (!facts) return refuse(false, "Job operation not found");

  // `member` with none named, and `optional` with none named on a later
  // operation, name no unit: nothing to read.
  const readsUnits = facts.serial
    ? !!requestedUnitId ||
      legacyUnitIndex !== undefined ||
      mode === "advance" ||
      mode === "start" ||
      mode === "require" ||
      mode === "claim" ||
      (mode === "optional" && facts.isFirstOperation)
    : facts.batch &&
      (mode === "advance" || mode === "start") &&
      !requestedUnitId;
  if (!readsUnits || !facts.jobMakeMethodId) {
    return decideWorkUnit({
      facts,
      units: [],
      operationId,
      requestedUnitId,
      mode,
      heldUnitId,
      legacyUnitIndex
    });
  }

  const units = await getOperationUnitAxis(client, {
    jobId: facts.jobId,
    operationId,
    jobMakeMethodId: facts.jobMakeMethodId,
    includeSerialOutputs: facts.serial && mode !== "member",
    companyId
  });
  if (units.error) {
    log.error("Could not read the operation's units", {
      companyId,
      operationId,
      error: units.error
    });
    return refuse(false, UNIT_CHECK_FAILED);
  }

  // A `member` write may name a unit on hold, and a lot is never on hold:
  // neither reads the holds. Every unit still to do is read, not only a named
  // one: "the next unit" and "the one left" skip a unit on hold.
  const holds =
    facts.serial && mode !== "member"
      ? await readUnitHolds(client, {
          companyId,
          unitIds: units.data.map((unit) => unit.id)
        })
      : { data: {}, error: null };
  if (holds.error) {
    log.error("Could not read the units on hold", {
      companyId,
      operationId,
      error: holds.error
    });
    return refuse(false, UNIT_CHECK_FAILED);
  }

  return decideWorkUnit({
    facts,
    units: units.data,
    operationId,
    requestedUnitId,
    mode,
    heldUnitId,
    legacyUnitIndex,
    onHold: holds.data
  });
}

type TrackedEntityRow = Database["public"]["Tables"]["trackedEntity"]["Row"];

type OperationUnitRead = {
  jobId: string;
  operationId: string;
  jobMakeMethodId: string;
  companyId: string;
  includeSerialOutputs: boolean;
};

/**
 * The units of an operation's make method, in unit-axis order, each flagged
 * with whether the operation applies to it. A rework copy applies only to the
 * units sent into it (`jobOperationTrackedEntity`); every other operation has
 * no scope rows and applies to every unit.
 *
 * The list is never narrowed: step records are keyed by a unit's position in
 * the full axis, so a filtered list would shift every position after a skipped
 * unit. Consumers read `inOperationScope` (via
 * `isSerialEntityIncompleteForOperation`) instead. Paged past PostgREST's
 * 1000-row cap, like `getOperationUnitAxis`, so the screens and the server
 * see the same units.
 */
export async function getTrackedEntitiesForOperation(
  client: SupabaseClient<Database>,
  args: OperationUnitRead
) {
  return readOperationUnits<TrackedEntityRow>(client, args, "*");
}

/**
 * `getTrackedEntitiesForOperation` for the unit-write gate: only the columns
 * the rule reads.
 */
export async function getOperationUnitAxis(
  client: SupabaseClient<Database>,
  args: OperationUnitRead
) {
  return readOperationUnits<
    Pick<TrackedEntityRow, "id" | "status" | "attributes">
  >(client, args, "id, status, attributes");
}

/** The one paged read of an operation's units, in unit-axis order. */
async function readOperationUnits<T extends { id: string }>(
  client: SupabaseClient<Database>,
  args: OperationUnitRead,
  columns: string
) {
  const [entities, scope, outputs, receipts] = await Promise.all([
    fetchAll<T>(() =>
      client
        .from("trackedEntity")
        .select(columns)
        .eq("attributes->>Job Make Method", args.jobMakeMethodId)
        .eq("companyId", args.companyId)
        .order("createdAt", { ascending: true })
        .order("readableId", { ascending: true })
        .order("id", { ascending: true })
    ),
    fetchAll<{ trackedEntityId: string }>(() =>
      client
        .from("jobOperationTrackedEntity")
        .select("trackedEntityId")
        .eq("jobOperationId", args.operationId)
        .eq("companyId", args.companyId)
        .order("trackedEntityId", { ascending: true })
    ),
    // Older serial production can have an activity output without a unit
    // attribute. Posting treats either as completion at this operation.
    args.includeSerialOutputs
      ? fetchAll<{ trackedEntityId: string }>(() =>
          client
            .from("trackedActivityOutput")
            .select("trackedEntityId, trackedActivity!inner(id)")
            .eq("companyId", args.companyId)
            .eq("trackedActivity.companyId", args.companyId)
            .eq("trackedActivity.sourceDocument", "Job Operation")
            .eq("trackedActivity.sourceDocumentId", args.operationId)
            .in("trackedActivity.type", ["Complete", "Produce"])
            .order("trackedActivityId")
            .order("trackedEntityId")
        )
      : { data: [], error: null },
    args.includeSerialOutputs
      ? fetchAll<{ trackedEntityId: string }>(() =>
          client
            .from("jobReceivedSerial")
            .select("trackedEntityId")
            .eq("companyId", args.companyId)
            .eq("jobId", args.jobId)
            .order("trackedEntityId")
        )
      : { data: [], error: null }
  ]);

  if (entities.error) return { data: null, error: entities.error };
  if (scope.error) return { data: null, error: scope.error };

  if (outputs.error) return { data: null, error: outputs.error };
  if (receipts.error) return { data: null, error: receipts.error };
  const scopedIds = new Set(scope.data?.map((row) => row.trackedEntityId));
  const completedIds = new Set(outputs.data?.map((row) => row.trackedEntityId));
  for (const receipt of receipts.data ?? []) {
    completedIds.add(receipt.trackedEntityId);
  }
  return {
    data: (entities.data ?? []).map((entity) => ({
      ...entity,
      inOperationScope: scopedIds.size === 0 || scopedIds.has(entity.id),
      completedOperationId: completedIds.has(entity.id)
        ? args.operationId
        : undefined
    })),
    error: null
  };
}
