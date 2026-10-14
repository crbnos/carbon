// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { MachineState } from "./types";

/**
 * The attribution engine: which job operation gets a device's run time.
 * Pure — no database, no env — so it imports nothing but types. The rules are
 * in `.claude/rules/oee-provider.md` → "Attribution rules".
 *
 * The sensor decides WHETHER the machine ran. The owner of each moment of a
 * run decides WHO gets it:
 *
 * - a moment while maintenance blocks the work center → the queue;
 * - a moment after an operator press in the same run → the queue (the press
 *   stopped the operator's time, not the machine);
 * - else the operation loaded at that moment, if it can still take time;
 * - else the queue.
 *
 * The facts give the same owners whatever order they arrive in. Time that a
 * Machine event or an unattributed row already holds is never recorded again.
 *
 * Instants are compared with `Date.parse`: they are absolute UTC instants,
 * the narrow exception in `.claude/rules/date-handling.md`.
 */

export type StoredStateChange = { changedAt: string; state: MachineState };

/**
 * One load of an operation on the work center (`workCenterLoad`): from
 * `from` until `to` (null while it is still loaded). `assignable` is false
 * once the operation is Done or Canceled or its job is locked.
 */
export type LoadPeriod = {
  jobOperationId: string;
  from: string;
  to: string | null;
  assignable: boolean;
};

/** A period maintenance blocks the work center (`to` null while it does). */
export type BlockPeriod = { from: string; to: string | null };

/** Time a Machine event or an unattributed row already holds. */
export type RecordedInterval = {
  id: string;
  kind: "event" | "unattributed";
  startTime: string;
  endTime: string | null;
};

export type PlanMachineTimeInput = {
  now: string;
  minimumStateSeconds: number;
  /** When the device was mapped to the work center. */
  mappedAt: string;
  currentState: MachineState | null;
  currentStateAt: string | null;
  /** The latest operator press. */
  lastManualChangeAt: string | null;
  /** The earliest press since the last sync, or null when there was none. */
  firstUnplannedPressAt: string | null;
  /** The work center's loads that may overlap the time planned. */
  loads: LoadPeriod[];
  /** The work center's maintenance blocks that may overlap the time planned. */
  blocks: BlockPeriod[];
  /** The newest open Machine event; `system` when the sync created it. */
  openMachineEvent: {
    id: string;
    jobOperationId: string;
    startTime: string;
    system: boolean;
  } | null;
  openUnattributed: { id: string; startTime: string } | null;
  lastMachineEventEndTime: string | null;
  /** Machine events and unattributed rows around the presses. */
  recordedIntervals: RecordedInterval[];
  /** Stored changes after `appliedThrough`, ascending by `changedAt`. */
  changes: StoredStateChange[];
};

export type MachineTimeWrite =
  | {
      kind: "insertMachineEvent";
      jobOperationId: string;
      startTime: string;
      endTime: string | null;
    }
  | { kind: "closeMachineEvent"; productionEventId: string; endTime: string }
  | { kind: "insertUnattributed"; startTime: string; endTime: string | null }
  | { kind: "closeUnattributed"; unattributedId: string; endTime: string }
  | {
      kind: "updateUnattributed";
      unattributedId: string;
      startTime: string;
      endTime: string;
    }
  | { kind: "deleteUnattributed"; unattributedId: string };

export type PlanMachineTimeResult = {
  writes: MachineTimeWrite[];
  currentState: MachineState | null;
  currentStateAt: string | null;
  /** `changedAt` of the last consumed change; null when nothing was consumed. */
  appliedThrough: string | null;
};

type Interval = { startTime: string; endTime: string };

/**
 * An open interval: an event or a queue row this run found (`id` set) or
 * opened. `owner` is the operation, or null for the queue; `system` is false
 * only for an operator's event.
 */
type Slot = {
  id: string | null;
  owner: string | null;
  startTime: string;
  system: boolean;
};

const at = (iso: string) => Date.parse(iso);

const contains = (
  period: { from: string; to: string | null },
  instant: string
) =>
  at(period.from) <= at(instant) &&
  (period.to === null || at(instant) < at(period.to));

/** The parts of `[start, end)` that no recorded interval holds. */
function unrecordedParts(
  start: string,
  end: string,
  recorded: { startTime: string; endTime: string | null }[]
): Interval[] {
  const parts: Interval[] = [];
  let cursor = start;
  const sorted = [...recorded].sort(
    (a, b) => at(a.startTime) - at(b.startTime)
  );
  for (const interval of sorted) {
    if (at(cursor) >= at(end)) break;
    if (interval.endTime !== null && at(interval.endTime) <= at(cursor)) {
      continue;
    }
    if (at(interval.startTime) >= at(end)) break;
    if (at(interval.startTime) > at(cursor)) {
      parts.push({ startTime: cursor, endTime: interval.startTime });
    }
    if (interval.endTime === null) return parts;
    if (at(interval.endTime) > at(cursor)) cursor = interval.endTime;
  }
  if (at(cursor) < at(end)) parts.push({ startTime: cursor, endTime: end });
  return parts;
}

/** `interval` less `cut`: zero, one or two intervals. */
function subtract(interval: Interval, cut: Interval): Interval[] {
  return [
    { startTime: interval.startTime, endTime: cut.startTime },
    { startTime: cut.endTime, endTime: interval.endTime }
  ]
    .map((part) => ({
      startTime:
        at(part.startTime) < at(interval.startTime)
          ? interval.startTime
          : part.startTime,
      endTime:
        at(part.endTime) > at(interval.endTime)
          ? interval.endTime
          : part.endTime
    }))
    .filter((part) => at(part.endTime) > at(part.startTime));
}

export function planMachineTime(
  input: PlanMachineTimeInput
): PlanMachineTimeResult {
  const writes: MachineTimeWrite[] = [];
  const minimumMs = input.minimumStateSeconds * 1000;
  const lastPress = input.lastManualChangeAt;
  const presses = [input.firstUnplannedPressAt, lastPress].filter(
    (press): press is string => press !== null
  );
  const recorded = [...input.recordedIntervals];

  let state = input.currentState;
  let stateAt = input.currentStateAt;
  let appliedThrough: string | null = null;

  const slots: Slot[] = [];
  if (input.openMachineEvent) {
    slots.push({
      id: input.openMachineEvent.id,
      owner: input.openMachineEvent.jobOperationId,
      startTime: input.openMachineEvent.startTime,
      system: input.openMachineEvent.system
    });
  }
  if (input.openUnattributed) {
    slots.push({
      id: input.openUnattributed.id,
      owner: null,
      startTime: input.openUnattributed.startTime,
      system: true
    });
  }

  // ── Owners ──────────────────────────────────────────────────────────────
  const blocked = (instant: string) =>
    input.blocks.some((block) => contains(block, instant));
  const pressedInRun = (instant: string, runStart: string) =>
    presses.some(
      (press) => at(runStart) < at(press) && at(press) <= at(instant)
    );
  const ownerAt = (instant: string, runStart: string) => {
    if (blocked(instant) || pressedInRun(instant, runStart)) return null;
    const load = input.loads.find((period) => contains(period, instant));
    return load?.assignable ? load.jobOperationId : null;
  };
  // Where an owner can change: a load or a block begins or ends, or a press.
  const edges = [
    ...input.loads.flatMap((load) => [load.from, load.to]),
    ...input.blocks.flatMap((block) => [block.from, block.to]),
    ...presses
  ]
    .filter((edge): edge is string => edge !== null)
    .sort((a, b) => at(a) - at(b));
  const edgesWithin = (start: string, end: string) =>
    edges.filter((edge) => at(edge) > at(start) && at(edge) < at(end));

  // ── Writes ──────────────────────────────────────────────────────────────
  // Closed time goes to its owner. Queue time shorter than the minimum is
  // dropped, like a short state.
  const writeClosed = (
    { startTime, endTime }: Interval,
    owner: string | null
  ) => {
    const interval = { startTime, endTime };
    if (owner) {
      writes.push({
        kind: "insertMachineEvent",
        jobOperationId: owner,
        ...interval
      });
    } else if (at(interval.endTime) - at(interval.startTime) >= minimumMs) {
      writes.push({ kind: "insertUnattributed", ...interval });
    } else {
      return;
    }
    recorded.push({
      id: "",
      kind: owner ? "event" : "unattributed",
      ...interval
    });
  };

  // A slot that ends at or before its start writes nothing new, and an
  // existing one closes at its own start.
  const closeSlot = (slot: Slot, end: string) => {
    const ends = at(end) > at(slot.startTime);
    if (slot.id === null) {
      if (ends)
        writeClosed({ startTime: slot.startTime, endTime: end }, slot.owner);
      return;
    }
    const endTime = ends ? end : slot.startTime;
    writes.push(
      slot.owner === null
        ? { kind: "closeUnattributed", unattributedId: slot.id, endTime }
        : { kind: "closeMachineEvent", productionEventId: slot.id, endTime }
    );
    // The interval it held now ends: replace the open one read from the
    // database, if there is one.
    const held = recorded.findIndex((interval) => interval.id === slot.id);
    if (held >= 0) recorded.splice(held, 1);
    recorded.push({
      id: slot.id,
      kind: slot.owner === null ? "unattributed" : "event",
      startTime: slot.startTime,
      endTime
    });
  };

  const closeSlots = (end: string, which: (slot: Slot) => boolean) => {
    for (const slot of slots.filter(which)) {
      slots.splice(slots.indexOf(slot), 1);
      closeSlot(slot, end);
    }
  };

  // The pieces of `[start, end)` that nothing holds, split where the owner
  // changes, each written to its owner. A piece that reaches `now` while the
  // machine runs opens instead (a queue piece once it has lasted the
  // minimum, so a machine winding down after a Pause records nothing).
  const recordRun = (start: string, end: string, runStart: string) => {
    for (const part of unrecordedParts(start, end, recorded)) {
      const bounds = [
        part.startTime,
        ...edgesWithin(part.startTime, part.endTime),
        part.endTime
      ];
      const pieces: (Interval & { owner: string | null })[] = [];
      for (const [i, startTime] of bounds.slice(0, -1).entries()) {
        const endTime = bounds[i + 1] ?? startTime;
        if (at(endTime) <= at(startTime)) continue;
        const owner = ownerAt(startTime, runStart);
        const last = pieces.at(-1);
        if (last && last.owner === owner) last.endTime = endTime;
        else pieces.push({ owner, startTime, endTime });
      }
      for (const piece of pieces) {
        if (piece.endTime !== input.now || state !== "Running") {
          writeClosed(piece, piece.owner);
        } else if (
          piece.owner ||
          at(input.now) - at(piece.startTime) >= minimumMs
        ) {
          slots.push({
            id: null,
            owner: piece.owner,
            startTime: piece.startTime,
            system: true
          });
        }
      }
    }
  };

  // Open slots follow their owner up to `until`: where the owner changes, a
  // slot closes and the new owner records the rest. An operator's event
  // follows only maintenance: a block stops it, a load change does not.
  const follow = (until: string) => {
    const runStart = stateAt ?? until;
    for (const slot of [...slots]) {
      const change = slot.system
        ? edgesWithin(slot.startTime, until).find(
            (edge) => ownerAt(edge, runStart) !== slot.owner
          )
        : input.blocks
            .map((block) => block.from)
            .find(
              (from) => at(from) > at(slot.startTime) && at(from) < at(until)
            );
      if (!change) continue;
      slots.splice(slots.indexOf(slot), 1);
      closeSlot(slot, change);
      recordRun(change, until, runStart);
    }
  };

  // ── Late stops trim the queue ──────────────────────────────────────────
  // A stop reported only after a press: a queue row that the press closed
  // may hold time the machine was idle. Queue rows are not posted, so they
  // are cut to the running time. Machine events are never trimmed.
  const trimIdle = (idle: Interval) => {
    for (const interval of [...recorded]) {
      if (
        interval.kind !== "unattributed" ||
        !interval.id ||
        interval.endTime === null ||
        at(idle.endTime) <= at(interval.startTime) ||
        at(idle.startTime) >= at(interval.endTime)
      ) {
        continue;
      }
      const row = { startTime: interval.startTime, endTime: interval.endTime };
      const [first, second] = subtract(row, idle);
      recorded.splice(recorded.indexOf(interval), 1);
      if (!first) {
        writes.push({
          kind: "deleteUnattributed",
          unattributedId: interval.id
        });
        continue;
      }
      writes.push({
        kind: "updateUnattributed",
        unattributedId: interval.id,
        ...first
      });
      recorded.push({ ...interval, ...first });
      if (second) {
        writes.push({ kind: "insertUnattributed", ...second });
        recorded.push({ id: "", kind: "unattributed", ...second });
      }
    }
  };

  // ── The time around the presses ────────────────────────────────────────
  // Time before the last press that no sync planned yet: from the earliest
  // unplanned press when the machine already ran then, or from a late
  // Running change. It ends at a late stop, or at the last press.
  let unplanned: { from: string; runStart: string } | null =
    state === "Running" &&
    stateAt !== null &&
    input.firstUnplannedPressAt !== null &&
    at(stateAt) <= at(input.firstUnplannedPressAt)
      ? { from: input.firstUnplannedPressAt, runStart: stateAt }
      : null;
  let idleFrom: string | null = null;
  // A machine running at the last press and still running after it.
  // (Typed by a cast: only the closures below assign it, which TypeScript's
  // narrowing cannot see.)
  let pastPress = null as { from: string; runStart: string } | null;
  let pressCrossed = false;

  // Leaving the time before the last press. `end` is a stop still pending
  // before the press: the run may end there, so nothing past it is recorded
  // until it settles.
  const crossPress = (end: string | null) => {
    if (pressCrossed || lastPress === null) return;
    pressCrossed = true;
    if (unplanned) {
      recordRun(unplanned.from, end ?? lastPress, unplanned.runStart);
    }
    unplanned = null;
    if (idleFrom !== null)
      trimIdle({ startTime: idleFrom, endTime: lastPress });
    idleFrom = null;
    if (
      end === null &&
      state === "Running" &&
      stateAt !== null &&
      at(stateAt) <= at(lastPress)
    ) {
      pastPress = { from: lastPress, runStart: stateAt };
    }
  };

  const apply = (next: MachineState, changedAt: string) => {
    if (next === state) return;
    // A change at or before the last press: the press decided what came
    // after it, so this fills only the time the press could not see.
    if (lastPress !== null && at(changedAt) <= at(lastPress)) {
      if (next === "Running") {
        if (idleFrom !== null) {
          trimIdle({ startTime: idleFrom, endTime: changedAt });
          idleFrom = null;
        }
        unplanned = { from: changedAt, runStart: changedAt };
      } else {
        if (unplanned) {
          recordRun(unplanned.from, changedAt, unplanned.runStart);
          unplanned = null;
        }
        idleFrom = changedAt;
      }
      state = next;
      stateAt = changedAt;
      return;
    }
    crossPress(null);
    if (next === "Running") {
      state = next;
      stateAt = changedAt;
      if (slots.length === 0) {
        slots.push({
          id: null,
          owner: ownerAt(changedAt, changedAt),
          startTime: changedAt,
          system: true
        });
      }
      return;
    }
    follow(changedAt);
    if (pastPress) {
      recordRun(pastPress.from, changedAt, pastPress.runStart);
      pastPress = null;
    }
    closeSlots(changedAt, () => true);
    state = next;
    stateAt = changedAt;
  };

  let changes = input.changes;

  // First sync: the last change before the mapping is the starting state, at
  // the time of the mapping. Time before the mapping is never charged.
  if (state === null) {
    const mappedAt = at(input.mappedAt);
    const before = changes.filter((c) => at(c.changedAt) <= mappedAt);
    changes = changes.filter((c) => at(c.changedAt) > mappedAt);
    const seed = before.at(-1);
    if (seed) {
      appliedThrough = seed.changedAt;
      apply(seed.state, input.mappedAt);
    }
  }

  // Repeated reports of one state are one run: the first starts it, the last
  // is how far it was read.
  const runs: (StoredStateChange & { through: string })[] = [];
  for (const change of changes) {
    const last = runs.at(-1);
    if (last && last.state === change.state) last.through = change.changedAt;
    else runs.push({ ...change, through: change.changedAt });
  }

  // Debounce: a state shorter than the minimum is dropped; the last change
  // stays pending until it has lasted the minimum.
  let pending: StoredStateChange | null = null;
  for (const [i, run] of runs.entries()) {
    const next = runs[i + 1];
    const end = next ? next.changedAt : input.now;
    if (at(end) - at(run.changedAt) < minimumMs) {
      if (!next) {
        pending = run;
        break;
      }
      appliedThrough = run.through;
      continue;
    }
    apply(run.state, run.changedAt);
    appliedThrough = run.through;
  }

  if (lastPress !== null) {
    crossPress(
      pending && at(pending.changedAt) <= at(lastPress)
        ? pending.changedAt
        : null
    );
  }

  if (state === "Running") {
    // Still running past the press: the time after it that nothing holds.
    if (pastPress && slots.length === 0) {
      recordRun(pastPress.from, input.now, pastPress.runStart);
    }
    // Steady state: the machine runs, nothing holds its time, and no press
    // decided it — an operation went Done mid-run, or maintenance or End
    // Shift closed the event.
    if (
      slots.length === 0 &&
      stateAt !== null &&
      (lastPress === null || at(stateAt) > at(lastPress))
    ) {
      const lastEnd = input.lastMachineEventEndTime;
      recordRun(
        lastEnd && at(lastEnd) > at(stateAt) ? lastEnd : stateAt,
        input.now,
        stateAt
      );
    }
    follow(input.now);
  } else if (stateAt !== null) {
    // Stopped by a late change before the press: the engine's own open time
    // ends at the stop (or at its start, when it opened after the stop).
    closeSlots(stateAt, (slot) => slot.system);
  }

  // A slot this run opened and did not close is inserted open.
  for (const slot of slots) {
    if (slot.id !== null) continue;
    writes.push(
      slot.owner === null
        ? {
            kind: "insertUnattributed",
            startTime: slot.startTime,
            endTime: null
          }
        : {
            kind: "insertMachineEvent",
            jobOperationId: slot.owner,
            startTime: slot.startTime,
            endTime: null
          }
    );
  }

  return {
    writes,
    currentState: state,
    currentStateAt: stateAt,
    appliedThrough
  };
}
