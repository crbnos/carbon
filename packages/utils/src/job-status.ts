// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A job in one of these statuses is locked: no edits and no more time. */
export const JOB_LOCKED_STATUSES = [
  "Completed",
  "Closed",
  "Cancelled"
] as const;

export function isJobLocked(status: string | null | undefined): boolean {
  return JOB_LOCKED_STATUSES.includes(
    status as (typeof JOB_LOCKED_STATUSES)[number]
  );
}
