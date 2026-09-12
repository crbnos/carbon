// Planned-duration model for a job operation batch. Dependency-free pure TS.
//
// Unlike batch-time-split.ts (a re-export of the Deno edge-runtime module),
// this lives directly in @carbon/utils: no edge function consumes it, so there
// is no Deno mirror to keep in sync. See
// .ai/specs/2026-09-04-batch-release-and-scheduling.md.

import { clamp } from "./math";

export type BatchDurationMember = {
  /** Planned setup time, in seconds. */
  setupDuration: number;
  /** Full planned labor time, in seconds (not netted for progress). */
  laborDuration: number;
  /** Full planned machine time, in seconds (not netted for progress). */
  machineDuration: number;
  /** Planned quantity for the member operation. */
  operationQuantity: number;
  /** Quantity already completed on the member operation. */
  quantityComplete: number;
};

export type BatchType = "Sequential" | "Simultaneous";

/**
 * Combine per-member values by the batch type: members run one after another
 * (Sequential → sum) or together in one load (Simultaneous → the longest).
 * The single rule `batchDuration` and `batchPlanBreakdown` share, so their run
 * totals cannot drift. Caller guards the empty case (Simultaneous's max over an
 * empty list is -Infinity).
 */
function combineRuns(values: number[], batchType: BatchType): number {
  return batchType === "Sequential"
    ? values.reduce((a, b) => a + b, 0)
    : Math.max(...values);
}

/**
 * Planned duration of an operation batch, in seconds.
 *
 * setup = max member setup, counted once (shared load), 0 when the batch has
 *         already recorded any production event (setup-done rule, matching the
 *         engine's remaining-work netting for single ops).
 * run_i  = max(labor_i, machine_i) scaled by the member's remaining fraction
 *          (1 - quantityComplete/operationQuantity, clamped to [0,1]; fraction
 *          is 1 when operationQuantity <= 0).
 * run    = Σ run_i (Sequential) | max run_i (Simultaneous).
 */
export function batchDuration(
  members: BatchDurationMember[],
  batchType: BatchType,
  options?: { hasAnyEvent?: boolean }
): number {
  if (members.length === 0) return 0;

  const setup = options?.hasAnyEvent
    ? 0
    : Math.max(...members.map((m) => m.setupDuration));

  const runs = members.map((m) => {
    const remainingFraction =
      m.operationQuantity > 0
        ? clamp(1 - m.quantityComplete / m.operationQuantity, 0, 1)
        : 1;
    return Math.max(m.laborDuration, m.machineDuration) * remainingFraction;
  });

  return setup + combineRuns(runs, batchType);
}

/** Pre-converted setup/labor/machine durations for one batch member. */
export type BatchMemberDurations = {
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
};

/**
 * Planned durations of an operation batch, broken out for display. Unlike
 * `batchDuration` this is not netted for progress and has no setup-done rule —
 * it is the full plan a user reads before the run starts.
 *
 * - `setup` = max member setup (one shared load).
 * - `labor` / `machine` = Σ (Sequential) | max (Simultaneous) — per-type
 *   buckets that survive as denominators for plan-vs-actual rows.
 * - `total` = setup + Σ|max of each member's run (`max(labor_i, machine_i)`),
 *   NOT setup + labor + machine: a member's labor and machine overlap on one
 *   wall clock, so summing the buckets double-counts. This matches the
 *   scheduler's reservation (`batchDuration`) for zero-progress members exactly.
 */
export type BatchPlanBreakdown = {
  setup: number;
  labor: number;
  machine: number;
  total: number;
};

export function batchPlanBreakdown(
  members: BatchMemberDurations[],
  batchType: BatchType
): BatchPlanBreakdown {
  if (members.length === 0) return { setup: 0, labor: 0, machine: 0, total: 0 };

  const setup = Math.max(...members.map((m) => m.setupDuration));
  const labor = combineRuns(
    members.map((m) => m.laborDuration),
    batchType
  );
  const machine = combineRuns(
    members.map((m) => m.machineDuration),
    batchType
  );
  const total =
    setup +
    combineRuns(
      members.map((m) => Math.max(m.laborDuration, m.machineDuration)),
      batchType
    );

  return { setup, labor, machine, total };
}
