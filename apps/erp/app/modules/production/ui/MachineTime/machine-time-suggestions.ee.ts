// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The best guesses for a slice of unattributed machine time: the operations
 * that ran on the same work center on the days it touches. Pure, so it is
 * tested without a database (`apps/erp/test/machine-time-suggestions.ee.test.ts`).
 *
 * Instants are compared as epoch milliseconds, which is safe for absolute
 * instants (`.claude/rules/date-handling.md` → Narrow exception).
 */

import { type MachineTimeRefusal, machineTimeRefusal } from "@carbon/ee/oee";

export type DayEvent = {
  jobOperationId: string;
  startTime: string;
  endTime: string | null;
  jobOperation: {
    id: string;
    description: string | null;
    status: string | null;
    job: {
      id: string;
      jobId: string;
      status: string | null;
      item: { readableIdWithRevision: string | null } | null;
    } | null;
  } | null;
};

export type MachineTimeSuggestion = {
  jobOperationId: string;
  jobReadableId: string;
  description: string;
  itemReadableId: string | null;
  firstStart: string;
  lastEnd: string | null;
  /** Time the operation's events covered inside the window. */
  totalMs: number;
  /** An event of the operation overlaps the unattributed interval. */
  overlaps: boolean;
  /** Why it cannot take the time, or null when it can. */
  blockedBy: MachineTimeRefusal | null;
};

/** The most cards the drawer shows; one shortcut key each. */
export const MACHINE_TIME_SUGGESTION_LIMIT = 6;

export function suggestMachineTimeOperations(args: {
  events: DayEvent[];
  interval: { startTime: string; endTime: string | null };
  /**
   * The start of the interval's first day to the end of its last day (the
   * end of today for a running interval), in the work center's timezone. An
   * interval across midnight takes suggestions from both days.
   */
  window: { start: string; end: string };
  nowMs: number;
  limit?: number;
}): MachineTimeSuggestion[] {
  const windowStart = Date.parse(args.window.start);
  const windowEnd = Date.parse(args.window.end);
  const from = Date.parse(args.interval.startTime);
  const to = args.interval.endTime
    ? Date.parse(args.interval.endTime)
    : args.nowMs;

  type Group = MachineTimeSuggestion & { gapMs: number };
  const groups = new Map<string, Group>();

  for (const event of args.events) {
    const operation = event.jobOperation;
    const job = operation?.job;
    if (!operation || !job) continue;

    const start = Date.parse(event.startTime);
    const end = event.endTime ? Date.parse(event.endTime) : args.nowMs;
    const covered = Math.max(
      0,
      Math.min(end, windowEnd) - Math.max(start, windowStart)
    );
    const overlaps = start < to && end > from;
    const gapMs = overlaps ? 0 : start >= to ? start - to : from - end;

    const group = groups.get(operation.id);
    if (group) {
      group.totalMs += covered;
      group.overlaps ||= overlaps;
      group.gapMs = Math.min(group.gapMs, gapMs);
      if (event.startTime < group.firstStart) {
        group.firstStart = event.startTime;
      }
      if (group.lastEnd !== null) {
        group.lastEnd =
          event.endTime === null
            ? null
            : event.endTime > group.lastEnd
              ? event.endTime
              : group.lastEnd;
      }
      continue;
    }

    groups.set(operation.id, {
      jobOperationId: operation.id,
      jobReadableId: job.jobId,
      description: operation.description ?? "",
      itemReadableId: job.item?.readableIdWithRevision ?? null,
      firstStart: event.startTime,
      lastEnd: event.endTime,
      totalMs: covered,
      overlaps,
      gapMs,
      blockedBy: machineTimeRefusal(operation.status, job.status)
    });
  }

  return [...groups.values()]
    .sort((a, b) => {
      // An operation that can take the time comes before one that cannot.
      if ((a.blockedBy === null) !== (b.blockedBy === null)) {
        return a.blockedBy === null ? -1 : 1;
      }
      if (a.gapMs !== b.gapMs) return a.gapMs - b.gapMs;
      return b.totalMs - a.totalMs;
    })
    .slice(0, args.limit ?? MACHINE_TIME_SUGGESTION_LIMIT)
    .map(({ gapMs: _gapMs, ...suggestion }) => suggestion);
}
