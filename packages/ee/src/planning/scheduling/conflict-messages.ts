/**
 * Cause-specific conflict messages for placements that finish after the job's
 * due date. The allocator knows WHY an operation is late (queued behind other
 * jobs on the machine or in the operator pool, waiting on a predecessor, no
 * runway, outside turnaround) — these helpers turn that into a message a
 * scheduler can act on.
 *
 * Pure module (no provider/database imports) so it stays type-checkable under
 * `deno test lib/scheduling/`. Strings are stored in the DB
 * (jobOperation.conflictReason) and shown verbatim on the schedule boards;
 * English by design, not i18n'd.
 */

import { businessDay } from "./date-utils.ts";

/**
 * Which finite resource pushed an operation's start past its earliest
 * feasible start, and who held it. Built by the slot allocator: `resource`
 * is the check that failed on the LAST probe before the successful
 * placement (the binding constraint), `blockers`/`ownJobAhead` describe
 * that resource's reservations in the wait region.
 */
export type WaitAttribution = {
  resource: "machine" | "operator";
  /** Other jobs' reservations in the wait region ("queued behind J000001 (3 ops)"), or null. */
  blockers: string | null;
  /** Untagged (this job's own in-run) reservations overlap the wait region. */
  ownJobAhead: boolean;
};

export type LatePlacementCause =
  /** Waited for the work center, busy with other jobs' operations. */
  | { kind: "machine-queue"; blockers: string }
  /** Waited for the work center, busy with this job's earlier operations. */
  | { kind: "machine-own-job" }
  /** Waited for the work center (machine-bound, no attributable reservation). */
  | { kind: "machine-wait" }
  /** Waited for a qualified operator busy on other jobs' operations. */
  | { kind: "operator-queue"; blockers: string }
  /** Waited for a qualified operator busy on this job's earlier operations. */
  | { kind: "own-job-queue" }
  /** Waited for a qualified operator (nobody on shift in the gap). */
  | { kind: "operator-wait" }
  /** Waited for the people assigned to the station (manning board). */
  | { kind: "people-wait" }
  /** Started on time for its own resources but a predecessor finished late. */
  | { kind: "inherited-delay"; predecessorDescription: string | null }
  /** Nothing delayed it — there simply isn't enough time before the due date. */
  | { kind: "no-runway" }
  /** Outside processing turnaround runs past the due date. */
  | { kind: "outside-processing" };

/**
 * Classify why a placed operation finishes late. `waitedMs` is how long the
 * operation sat between its earliest feasible start and its actual start;
 * `wait` is the allocator's attribution of that delay (null when the wait
 * came from a shift gap the walk snapped over, not a failed resource check);
 * `dominantDep` is set when a predecessor's in-run placement (not "now" or
 * the backward-pass start date) was the binding lower bound on the start.
 */
export function classifyLatePlacement(args: {
  waitedMs: number;
  wait: WaitAttribution | null;
  dominantDep: { description: string | null } | null;
  /**
   * The placement's people came from the manning board (an ungated op at a
   * assigned station) — person-bound waits are "the assigned people", not
   * "a qualified operator".
   */
  staffed?: boolean;
}): LatePlacementCause {
  const { waitedMs, wait, dominantDep, staffed } = args;
  if (waitedMs > 0) {
    if (wait?.resource === "machine") {
      if (wait.blockers)
        return { kind: "machine-queue", blockers: wait.blockers };
      if (wait.ownJobAhead) return { kind: "machine-own-job" };
      return { kind: "machine-wait" };
    }
    if (staffed) return { kind: "people-wait" };
    // Operator-bound wait — or a shift-gap snap (wait === null), which for a
    // gated op means nobody qualified was on shift in the gap
    if (wait?.blockers)
      return { kind: "operator-queue", blockers: wait.blockers };
    if (wait?.ownJobAhead) return { kind: "own-job-queue" };
    return { kind: "operator-wait" };
  }
  if (dominantDep) {
    return {
      kind: "inherited-delay",
      predecessorDescription: dominantDep.description
    };
  }
  return { kind: "no-runway" };
}

/** "45m", "14h", "2d 3h" — coarse on purpose; it labels a Gantt bar. */
export function formatWaitDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * Neutral explanation of a placement's timing, stored on the reservation for
 * EVERY placed operation (composeLateConflict is the alarmed variant used
 * only when the job will finish late). Returns null when the operation
 * started as early as it could — nothing to explain.
 */
export function composePlacementNote(
  cause: LatePlacementCause,
  waitedMs: number
): string | null {
  switch (cause.kind) {
    case "machine-queue":
      return `Waited ${formatWaitDuration(waitedMs)} for the work center — ${
        cause.blockers
      }`;
    case "machine-own-job":
      return `Waited ${formatWaitDuration(
        waitedMs
      )} for the work center — busy with earlier operations in this job`;
    case "machine-wait":
      return `Waited ${formatWaitDuration(
        waitedMs
      )} for the work center to be available`;
    case "operator-queue":
      return `Waited ${formatWaitDuration(waitedMs)} for a qualified operator — ${
        cause.blockers
      }`;
    case "own-job-queue":
      return `Waited ${formatWaitDuration(
        waitedMs
      )} for a qualified operator — busy with earlier operations in this job`;
    case "operator-wait":
      return `Waited ${formatWaitDuration(
        waitedMs
      )} for a qualified operator to be available`;
    case "people-wait":
      return `Waited ${formatWaitDuration(waitedMs)} for the assigned people`;
    case "inherited-delay":
      return cause.predecessorDescription
        ? `Starts after "${cause.predecessorDescription}" finishes`
        : "Starts after an earlier operation in this job finishes";
    case "no-runway":
    case "outside-processing":
      return null;
  }
}

/**
 * One operation's dual dates for the behind-target attribution (spec
 * 2026-08-15 dual dates): the backward need-by TARGET ("YYYY-MM-DD" | null —
 * null when the job has no due date) and the forward placement's projected
 * finish (exact instant | null — null when placement failed).
 */
export type BehindTargetOperation = {
  description: string | null;
  /** Backward need-by target ("YYYY-MM-DD"). */
  needBy: string | null;
  /** Forward placement's projected finish (ISO instant). */
  projectedCompletionAt: string | null;
};

/**
 * Job-level lateness attribution: names the FIRST operation whose projected
 * finish lands on a business day AFTER its need-by target. Callers pass the
 * operations in topological order (the engine's dependency-graph order), so
 * "first" means first in the routing — the earliest point the plan falls
 * behind its targets. Ops missing either date are skipped; returns null when
 * nothing is behind target. Appended to the JOB's late-conflict sentence
 * only — targets are informational and never set per-op conflicts.
 */
export function composeBehindTarget(
  operations: BehindTargetOperation[],
  timeZone: string
): string | null {
  for (const op of operations) {
    if (!op.needBy || !op.projectedCompletionAt) continue;
    const projectedDay = businessDay(op.projectedCompletionAt, timeZone);
    if (projectedDay > op.needBy) {
      return `First behind target: ${
        op.description ? op.description : "an operation"
      } (due ${op.needBy}, projected ${projectedDay})`;
    }
  }
  return null;
}

export function composeLateConflict(
  finishDate: string, // "YYYY-MM-DD"
  jobDueDate: string, // "YYYY-MM-DD"
  cause: LatePlacementCause
): string {
  const late = `Finishes ${finishDate} but the job is due ${jobDueDate}`;
  switch (cause.kind) {
    case "machine-queue":
      return `${late} — waited for the work center, ${cause.blockers}`;
    case "machine-own-job":
      return `${late} — waited for the work center, busy with earlier operations in this job`;
    case "machine-wait":
      return `${late} — waited for the work center to be available`;
    case "operator-queue":
      return `${late} — waited for a qualified operator, ${cause.blockers}`;
    case "own-job-queue":
      return `${late} — waited for a qualified operator, busy with earlier operations in this job`;
    case "operator-wait":
      return `${late} — waited for a qualified operator to be available`;
    case "people-wait":
      return `${late} — waited for the assigned people to be available`;
    case "inherited-delay":
      return `${late} — starts late because it waits for ${
        cause.predecessorDescription
          ? `"${cause.predecessorDescription}"`
          : "an earlier operation"
      } earlier in this job; its own work center was free`;
    case "no-runway":
      return `${late} — not enough time remains before the due date`;
    case "outside-processing":
      return `${late} — outside processing pushes it past the due date`;
  }
}
