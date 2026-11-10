// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Progress of a long backup job, written to its marker row for the page to read.
 */

/** Integration key for the in-place restore marker (holds the snapshot path). */
export const RESTORE_INTEGRATION = "company-restore";

/** Live progress of the current phase. `phase` is a stable KEY
 *  (`snapshot`/`seed`/`wipe`/`load`/`files`); the UI maps it to a human label per
 *  job, so the job never bakes in display copy. */
export type JobProgress = { phase: string; done: number; total: number };

const PROGRESS_THROTTLE_MS = 250;

/**
 * Wrap a marker write so same-phase ticks inside the window are dropped, but a
 * phase change or a terminal `done === total` always flushes. The wipe/load loops
 * report per table — each write is a read-then-write on a JSONB column, so
 * unthrottled it is hundreds of round-trips against the same row.
 */
export function throttleProgress(
  write: (p: JobProgress) => Promise<void>
): (p: JobProgress) => Promise<void> {
  let lastAt = 0;
  let lastPhase = "";
  return async (progress) => {
    const now = Date.now();
    const terminal = progress.done >= progress.total;
    if (
      progress.phase === lastPhase &&
      !terminal &&
      now - lastAt < PROGRESS_THROTTLE_MS
    ) {
      return;
    }
    lastPhase = progress.phase;
    lastAt = now;
    await write(progress);
  };
}
