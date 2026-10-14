// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { MachineState } from "./types";

/**
 * The attribution engine: which job operation gets a device's run time.
 * Pure — no database, no env — so it imports nothing but types. The spec is
 * `.ai/specs/2026-10-12-oee-provider-integration.md` → "Attribution rules".
 *
 * Instants are compared with `Date.parse`: they are absolute UTC instants,
 * the narrow exception in `.claude/rules/date-handling.md`.
 */

export type StoredStateChange = { changedAt: string; state: MachineState };

/**
 * One load of an operation on the work center (`workCenterLoad`): from
 * `from` until `to` (null while it is still loaded). `assignable` is false
 * once the operation is Done or Canceled or its job is locked: time then goes
 * to the queue.
 */
export type LoadPeriod = {
  jobOperationId: string;
  from: string;
  to: string | null;
  assignable: boolean;
};

export type PlanMachineTimeInput = {
  now: string;
  minimumStateSeconds: number;
  /** When the device was mapped to the work center. */
  mappedAt: string;
  currentState: MachineState | null;
  currentStateAt: string | null;
  lastManualChangeAt: string | null;
  /** The work center's loads that may overlap the time planned. */
  loads: LoadPeriod[];
  /**
   * When maintenance began blocking the work center, or null when nothing
   * blocks it. Run time from then on is unattributed, never the job's.
   */
  blockedSince: string | null;
  openMachineEvent: { id: string; startTime: string } | null;
  openUnattributed: { id: string; startTime: string } | null;
  lastMachineEventEndTime: string | null;
  /**
   * Machine events and unattributed rows on the work center that may overlap
   * the time around the last press (`endTime` null while open). Time they
   * already hold is never recorded twice.
   */
  recordedIntervals: { startTime: string; endTime: string | null }[];
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
  | { kind: "closeUnattributed"; unattributedId: string; endTime: string };

export type PlanMachineTimeResult = {
  writes: MachineTimeWrite[];
  currentState: MachineState | null;
  currentStateAt: string | null;
  /** `changedAt` of the last consumed change; null when nothing was consumed. */
  appliedThrough: string | null;
};

/** An open interval this run found (`existing`, closed by id) or opened (`new`). */
type EventSlot =
  | { kind: "existing"; id: string; startTime: string }
  | { kind: "new"; jobOperationId: string; startTime: string };
type UnattributedSlot =
  | { kind: "existing"; id: string; startTime: string }
  | { kind: "new"; startTime: string };

const at = (iso: string) => Date.parse(iso);

/** The parts of `[start, end)` that no recorded interval holds. */
function unrecordedParts(
  start: string,
  end: string,
  recorded: PlanMachineTimeInput["recordedIntervals"]
) {
  const parts: { startTime: string; endTime: string }[] = [];
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

export function planMachineTime(
  input: PlanMachineTimeInput
): PlanMachineTimeResult {
  const writes: MachineTimeWrite[] = [];
  const minimumMs = input.minimumStateSeconds * 1000;
  const pressedAt =
    input.lastManualChangeAt === null ? null : at(input.lastManualChangeAt);

  let state = input.currentState;
  let stateAt = input.currentStateAt;
  let appliedThrough: string | null = null;
  let openEvent: EventSlot | null = input.openMachineEvent
    ? {
        kind: "existing",
        id: input.openMachineEvent.id,
        startTime: input.openMachineEvent.startTime
      }
    : null;
  let openUnattributed: UnattributedSlot | null = input.openUnattributed
    ? {
        kind: "existing",
        id: input.openUnattributed.id,
        startTime: input.openUnattributed.startTime
      }
    : null;
  const blockedAt = input.blockedSince === null ? null : at(input.blockedSince);

  // The operation that takes running time starting at `at`: the one loaded
  // then (not now), if it can still take time and maintenance did not block
  // the work center by then. Null means the queue.
  const ownerAt = (instant: string) => {
    if (blockedAt !== null && at(instant) >= blockedAt) return null;
    const load = input.loads.find(
      (period) =>
        at(period.from) <= at(instant) &&
        (period.to === null || at(instant) < at(period.to))
    );
    return load?.assignable ? load.jobOperationId : null;
  };

  const openRunning = (start: string) => {
    if (openEvent || openUnattributed) return;
    const owner = ownerAt(start);
    if (owner) {
      openEvent = { kind: "new", jobOperationId: owner, startTime: start };
    } else {
      openUnattributed = { kind: "new", startTime: start };
    }
  };

  // Closed time no slot holds, written where it belongs. `byLoad` splits it
  // where a load or the block begins or ends and gives each piece to its
  // owner; otherwise all of it is unattributed. Unattributed time shorter
  // than the minimum is dropped, like a short state.
  const recordParts = (start: string, end: string, byLoad: boolean) => {
    for (const part of unrecordedParts(start, end, input.recordedIntervals)) {
      const edges = byLoad
        ? [
            ...input.loads.flatMap((load) =>
              load.to === null ? [load.from] : [load.from, load.to]
            ),
            ...(input.blockedSince ? [input.blockedSince] : [])
          ].filter(
            (edge) =>
              at(edge) > at(part.startTime) && at(edge) < at(part.endTime)
          )
        : [];
      const bounds = [
        part.startTime,
        ...edges.sort((a, b) => at(a) - at(b)),
        part.endTime
      ];
      // Adjacent pieces with one owner are one piece.
      const pieces: {
        owner: string | null;
        startTime: string;
        endTime: string;
      }[] = [];
      for (const [i, startTime] of bounds.slice(0, -1).entries()) {
        const endTime = bounds[i + 1] ?? startTime;
        if (at(endTime) <= at(startTime)) continue;
        const owner = byLoad ? ownerAt(startTime) : null;
        const last = pieces.at(-1);
        if (last && last.owner === owner) last.endTime = endTime;
        else pieces.push({ owner, startTime, endTime });
      }
      for (const piece of pieces) {
        if (piece.owner) {
          writes.push({
            kind: "insertMachineEvent",
            jobOperationId: piece.owner,
            startTime: piece.startTime,
            endTime: piece.endTime
          });
        } else if (at(piece.endTime) - at(piece.startTime) >= minimumMs) {
          writes.push({
            kind: "insertUnattributed",
            startTime: piece.startTime,
            endTime: piece.endTime
          });
        }
      }
    }
  };

  // A close always clears the slot. An end at or before the start drops a slot
  // this run opened, and closes an existing one at its own start.
  const closeEvent = (end: string) => {
    const slot = openEvent;
    if (!slot) return;
    openEvent = null;
    const ends = at(end) > at(slot.startTime);
    if (slot.kind === "existing") {
      writes.push({
        kind: "closeMachineEvent",
        productionEventId: slot.id,
        endTime: ends ? end : slot.startTime
      });
    } else if (ends) {
      writes.push({
        kind: "insertMachineEvent",
        jobOperationId: slot.jobOperationId,
        startTime: slot.startTime,
        endTime: end
      });
    }
  };

  const closeUnattributed = (end: string) => {
    const slot = openUnattributed;
    if (!slot) return;
    openUnattributed = null;
    const ends = at(end) > at(slot.startTime);
    if (slot.kind === "existing") {
      writes.push({
        kind: "closeUnattributed",
        unattributedId: slot.id,
        endTime: ends ? end : slot.startTime
      });
    } else if (ends) {
      writes.push({
        kind: "insertUnattributed",
        startTime: slot.startTime,
        endTime: end
      });
    }
  };

  const closeAll = (end: string) => {
    closeEvent(end);
    closeUnattributed(end);
  };

  // A slot this run opened and did not close is inserted open.
  const insertStillOpen = () => {
    if (openEvent?.kind === "new") {
      writes.push({
        kind: "insertMachineEvent",
        jobOperationId: openEvent.jobOperationId,
        startTime: openEvent.startTime,
        endTime: null
      });
    }
    if (openUnattributed?.kind === "new") {
      writes.push({
        kind: "insertUnattributed",
        startTime: openUnattributed.startTime,
        endTime: null
      });
    }
  };

  // Maintenance begins: an event that started before the block stops at it,
  // and a running machine carries on as unattributed time. An operator press
  // after the block already decided ("latest change wins").
  let blockPending =
    blockedAt !== null && (pressedAt === null || pressedAt < blockedAt);
  const enterBlock = () => {
    if (!blockPending || input.blockedSince === null) return;
    blockPending = false;
    if (!openEvent || at(openEvent.startTime) >= (blockedAt ?? 0)) return;
    closeEvent(input.blockedSince);
    if (state === "Running") openRunning(input.blockedSince);
  };

  // A run the provider reported only after an operator press: the machine
  // ran before the press, and nothing recorded it (the press ended nothing).
  // The time up to the press goes to the operation loaded then, or to the
  // queue, less what an event or a row already holds. That is what an
  // earlier report would have recorded, so the order of arrival does not
  // change the result.
  let unrecordedFrom: string | null = null;
  const recordUnrecorded = (end: string) => {
    const start = unrecordedFrom;
    if (start === null) return;
    unrecordedFrom = null;
    recordParts(start, end, true);
  };

  // A machine already running at the press and still running after it: the
  // press (a Pause) stopped the operator's time, not the machine. The time
  // after the press that nothing holds is unattributed, never the loaded
  // operation's: the operator said to stop charging it.
  let runningPastPressFrom: string | null = null;
  let pressCrossed = false;
  const crossPress = () => {
    if (pressCrossed || input.lastManualChangeAt === null) return;
    pressCrossed = true;
    recordUnrecorded(input.lastManualChangeAt);
    if (
      state === "Running" &&
      stateAt !== null &&
      at(stateAt) <= (pressedAt ?? 0)
    ) {
      runningPastPressFrom = input.lastManualChangeAt;
    }
  };

  const apply = (next: MachineState, changedAt: string) => {
    if (next === state) return;
    // Latest change wins: an operator press after this change already decided.
    if (pressedAt !== null && at(changedAt) <= pressedAt) {
      state = next;
      stateAt = changedAt;
      if (next === "Running") unrecordedFrom = changedAt;
      else recordUnrecorded(changedAt);
      return;
    }
    crossPress();
    if (runningPastPressFrom !== null && next !== "Running") {
      recordParts(runningPastPressFrom, changedAt, false);
      runningPastPressFrom = null;
    }
    state = next;
    stateAt = changedAt;
    if (next === "Running") openRunning(changedAt);
    else closeAll(changedAt);
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
    if (blockedAt !== null && at(run.changedAt) >= blockedAt) enterBlock();
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

  if (blockedAt !== null && blockedAt <= at(input.now)) enterBlock();

  // The run before the press ends at the press, or at a change still pending
  // debounce before it: that change may yet stop the machine earlier.
  if (input.lastManualChangeAt !== null) {
    recordUnrecorded(
      pending && at(pending.changedAt) < at(input.lastManualChangeAt)
        ? pending.changedAt
        : input.lastManualChangeAt
    );
    crossPress();
  }

  // Still running past the press: once the machine has run the minimum past
  // the press, the time nothing holds opens as unattributed time. A machine
  // that stops sooner, as it winds down after a Pause, records nothing.
  if (runningPastPressFrom !== null && !openEvent && !openUnattributed) {
    for (const part of unrecordedParts(
      runningPastPressFrom,
      input.now,
      input.recordedIntervals
    )) {
      if (at(part.endTime) - at(part.startTime) < minimumMs) continue;
      // The part that reaches now is still running: it opens.
      if (part.endTime === input.now) {
        openUnattributed = { kind: "new", startTime: part.startTime };
      } else {
        writes.push({ kind: "insertUnattributed", ...part });
      }
    }
  }

  // Steady state: the machine runs and nothing holds its time — an operation
  // went Done mid-run, or maintenance / End Shift closed the event.
  if (
    state === "Running" &&
    stateAt !== null &&
    (pressedAt === null || at(stateAt) > pressedAt) &&
    !openEvent &&
    !openUnattributed
  ) {
    const lastEnd = input.lastMachineEventEndTime;
    openRunning(lastEnd && at(lastEnd) > at(stateAt) ? lastEnd : stateAt);
  }

  insertStillOpen();

  return {
    writes,
    currentState: state,
    currentStateAt: stateAt,
    appliedThrough
  };
}
