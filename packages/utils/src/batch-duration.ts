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

  const run =
    batchType === "Sequential"
      ? runs.reduce((a, b) => a + b, 0)
      : Math.max(...runs);

  return setup + run;
}
