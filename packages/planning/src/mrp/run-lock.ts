// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One MRP run per company at a time, without a connection per waiting run.
// A run tries the MRP run lock in a short transaction of its own; when the
// lock is not granted that transaction ends at once and the run sleeps
// before the next try, so a queued run holds no pool connection. When it is
// granted, that transaction stays open, doing nothing else, until the run
// ends (commit or rollback releases the lock).

import type { DB } from "@carbon/database/client";
import { tryLockCompanyMrpRun } from "@carbon/database/planning-lock";
import { getLogger, type Logger } from "@carbon/logger";
import type { Kysely } from "kysely";

/** The wait between two tries of the run lock. */
export const RUN_LOCK_POLL_MS = 250;
/**
 * How long a run waits for the run lock before it runs without it. Short on
 * purpose: inline callers (job release, a PO status change, an item save)
 * await their run, so a long queue would hold the request. Past the wait the
 * snapshot checks under the planning lock still stop a run from overwriting
 * a change; an overlap costs a retry, not correctness.
 */
export const RUN_LOCK_MAX_WAIT_MS = 15_000;

export type RunLockOptions = {
  pollMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
};

/** Thrown inside the try's transaction so Kysely rolls it back at once. */
class RunLockNotGranted extends Error {}

const sleepFor = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `run` holding the company's MRP run lock. Polls for the lock every
 * `pollMs`; after `maxWaitMs` of waiting it runs without the lock and logs a
 * warning. The planning lock and the planned-order snapshot checks still
 * guard the writes then, so two overlapping runs cost retries, not
 * correctness. The wait is counted in tries, so it needs no clock.
 */
export async function withCompanyMrpRunLock<T>(
  db: Kysely<DB>,
  companyId: string,
  run: () => Promise<T>,
  options: RunLockOptions = {}
): Promise<T> {
  const pollMs = options.pollMs ?? RUN_LOCK_POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? RUN_LOCK_MAX_WAIT_MS;
  const sleep = options.sleep ?? sleepFor;
  const logger = options.logger ?? getLogger("planning", "mrp");

  for (let waitedMs = 0; ; waitedMs += pollMs) {
    try {
      return await db.transaction().execute(async (runLock) => {
        if (!(await tryLockCompanyMrpRun(runLock, companyId))) {
          throw new RunLockNotGranted();
        }
        return run();
      });
    } catch (error) {
      if (!(error instanceof RunLockNotGranted)) throw error;
    }
    if (waitedMs >= maxWaitMs) {
      logger.warning(
        "another MRP run held the company's run lock too long; running without it",
        { companyId, waitedMs }
      );
      return run();
    }
    await sleep(pollMs);
  }
}
