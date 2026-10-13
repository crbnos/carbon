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
  isBlocked: boolean;
  openMachineEvent: { id: string; startTime: string } | null;
  openUnattributed: { id: string; startTime: string } | null;
  lastMachineEventEndTime: string | null;
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

/** An open interval: `id` when it already exists, none when this run opened it. */
type Slot = { id?: string; startTime: string };
/** An existing event's operation is never read: it is closed by `id`. */
type EventSlot = Slot & { jobOperationId: string };

const at = (iso: string) => Date.parse(iso);

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
    ? { ...input.openMachineEvent, jobOperationId: "" }
    : null;
  let openUnattributed: Slot | null = input.openUnattributed
    ? { ...input.openUnattributed }
    : null;

  // Running time goes to the loaded operation only when the work center is
  // not blocked by maintenance and the operation was loaded by then.
  const openRunning = (start: string) => {
    if (openEvent || openUnattributed) return;
    const loaded = input.loadedJobOperationId;
    if (
      !input.isBlocked &&
      loaded &&
      input.loadedAt &&
      at(input.loadedAt) <= at(start)
    ) {
      openEvent = { startTime: start, jobOperationId: loaded };
    } else {
      openUnattributed = { startTime: start };
    }
  };

  const closeAll = (end: string) => {
    if (openEvent && at(end) > at(openEvent.startTime)) {
      writes.push(
        openEvent.id
          ? {
              kind: "closeMachineEvent",
              productionEventId: openEvent.id,
              endTime: end
            }
          : {
              kind: "insertMachineEvent",
              jobOperationId: openEvent.jobOperationId,
              startTime: openEvent.startTime,
              endTime: end
            }
      );
      openEvent = null;
    }
    if (openUnattributed && at(end) > at(openUnattributed.startTime)) {
      writes.push(
        openUnattributed.id
          ? {
              kind: "closeUnattributed",
              unattributedId: openUnattributed.id,
              endTime: end
            }
          : {
              kind: "insertUnattributed",
              startTime: openUnattributed.startTime,
              endTime: end
            }
      );
      openUnattributed = null;
    }
  };

  const apply = (next: MachineState, changedAt: string) => {
    if (next === state) return;
    state = next;
    stateAt = changedAt;
    // Latest change wins: an operator press after this change already decided.
    if (pressedAt !== null && at(changedAt) <= pressedAt) return;
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

  // Debounce: a state shorter than the minimum is dropped; the last change
  // stays pending until it has lasted the minimum.
  for (const [i, change] of changes.entries()) {
    const next = changes[i + 1];
    const end = next ? next.changedAt : input.now;
    if (at(end) - at(change.changedAt) < minimumMs) {
      if (!next) break;
      appliedThrough = change.changedAt;
      continue;
    }
    apply(change.state, change.changedAt);
    appliedThrough = change.changedAt;
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

  const event = openEvent as EventSlot | null;
  if (event && !event.id) {
    writes.push({
      kind: "insertMachineEvent",
      jobOperationId: event.jobOperationId,
      startTime: event.startTime,
      endTime: null
    });
  }
  const unattributed = openUnattributed as Slot | null;
  if (unattributed && !unattributed.id) {
    writes.push({
      kind: "insertUnattributed",
      startTime: unattributed.startTime,
      endTime: null
    });
  }

  return {
    writes,
    currentState: state,
    currentStateAt: stateAt,
    appliedThrough
  };
}
