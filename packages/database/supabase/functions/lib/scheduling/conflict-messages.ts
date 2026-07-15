/**
 * Cause-specific conflict messages for placements that finish after the job's
 * due date. The selector knows WHY an operation is late (queued behind other
 * jobs, waiting on a predecessor, no runway, outside turnaround) — these
 * helpers turn that into a message a scheduler can act on.
 *
 * Pure module (no provider/database imports) so it stays type-checkable under
 * `deno test lib/scheduling/`. Strings are stored in the DB
 * (jobOperation.conflictReason) and shown verbatim on the schedule boards;
 * English by design, not i18n'd.
 */

export type LatePlacementCause =
  /** Waited for a qualified operator busy on other jobs' operations. */
  | { kind: "operator-queue"; blockers: string }
  /** Waited for a qualified operator busy on this job's earlier operations. */
  | { kind: "own-job-queue" }
  /** Waited for a qualified operator (nobody on shift in the gap). */
  | { kind: "operator-wait" }
  /** Started on time for its own resources but a predecessor finished late. */
  | { kind: "inherited-delay"; predecessorDescription: string | null }
  /** Nothing delayed it — there simply isn't enough time before the due date. */
  | { kind: "no-runway" }
  /** Outside processing turnaround runs past the due date. */
  | { kind: "outside-processing" };

/**
 * Classify why a placed operation finishes late. `waitedMs` is how long the
 * operation sat between its earliest feasible start and its actual start;
 * `dominantDep` is set when a predecessor's in-run placement (not "now" or
 * the backward-pass start date) was the binding lower bound on the start.
 */
export function classifyLatePlacement(args: {
  waitedMs: number;
  blockers: string | null;
  ownJobAhead: boolean;
  dominantDep: { description: string | null } | null;
}): LatePlacementCause {
  const { waitedMs, blockers, ownJobAhead, dominantDep } = args;
  if (waitedMs > 0) {
    if (blockers) return { kind: "operator-queue", blockers };
    if (ownJobAhead) return { kind: "own-job-queue" };
    return { kind: "operator-wait" };
  }
  if (dominantDep) {
    return {
      kind: "inherited-delay",
      predecessorDescription: dominantDep.description,
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
    case "inherited-delay":
      return cause.predecessorDescription
        ? `Starts after "${cause.predecessorDescription}" finishes`
        : "Starts after an earlier operation in this job finishes";
    case "no-runway":
    case "outside-processing":
      return null;
  }
}

export function composeLateConflict(
  finishDate: string, // "YYYY-MM-DD"
  jobDueDate: string, // "YYYY-MM-DD"
  cause: LatePlacementCause
): string {
  const late = `Finishes ${finishDate} but the job is due ${jobDueDate}`;
  switch (cause.kind) {
    case "operator-queue":
      return `${late} — waited for a qualified operator, ${cause.blockers}`;
    case "own-job-queue":
      return `${late} — waited for a qualified operator, busy with earlier operations in this job`;
    case "operator-wait":
      return `${late} — waited for a qualified operator to be available`;
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
