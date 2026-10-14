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

export type PlanMachineTimeInput = {
  now: string;
  minimumStateSeconds: number;
  /** When the device was mapped to the work center. */
  mappedAt: string;
  currentState: MachineState | null;
  currentStateAt: string | null;
  lastManualChangeAt: string | null;
  loadedJobOperationId: string | null;
  loadedAt: string | null;
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
   * the time before the last press (`endTime` null while open). Time they
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

  // Running time goes to the loaded operation only when the work center was
  // not blocked by maintenance at the start and the operation was loaded by then.
  const openRunning = (start: string) => {
    if (openEvent || openUnattributed) return;
    const loaded = input.loadedJobOperationId;
    if (
      (blockedAt === null || at(start) < blockedAt) &&
      loaded &&
      input.loadedAt &&
      at(input.loadedAt) <= at(start)
    ) {
      openEvent = { kind: "new", jobOperationId: loaded, startTime: start };
    } else {
      openUnattributed = { kind: "new", startTime: start };
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
  // The time up to the press is unattributed, less what an event or a row
  // already holds. The press still decides everything after it.
  let unrecordedFrom: string | null = null;
  const recordUnrecorded = (end: string) => {
    const start = unrecordedFrom;
    if (start === null) return;
    unrecordedFrom = null;
    for (const part of unrecordedParts(start, end, input.recordedIntervals)) {
      if (at(part.endTime) - at(part.startTime) < minimumMs) continue;
      writes.push({ kind: "insertUnattributed", ...part });
    }
  };

  const apply = (next: MachineState, changedAt: string) => {
    if (next === state) return;
    state = next;
    stateAt = changedAt;
    // Latest change wins: an operator press after this change already decided.
    if (pressedAt !== null && at(changedAt) <= pressedAt) {
      if (next === "Running") unrecordedFrom = changedAt;
      else recordUnrecorded(changedAt);
      return;
    }
    if (input.lastManualChangeAt !== null) {
      recordUnrecorded(input.lastManualChangeAt);
    }
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
