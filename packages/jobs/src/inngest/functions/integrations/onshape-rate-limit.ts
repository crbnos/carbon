// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { OnshapeApiError } from "@carbon/ee/onshape";
import { RetryAfterError } from "inngest";

const RATE_LIMIT_DEFAULT_WAIT_SECONDS = 60;
// Clamp Onshape's Retry-After so a bad/huge value can't schedule an absurd wait.
const RATE_LIMIT_MAX_WAIT_SECONDS = 300;

// On a 429, surface it to Inngest as a RetryAfterError rather than blocking the
// step with an in-process sleep. Inngest SUSPENDS the function — releasing its
// compute window and the per-company concurrency slot — and reschedules it after
// the delay; the memoized steps mean it resumes at the first unfinished item, and
// every export/attach is idempotent so a re-run is safe. The wait honors Onshape's
// Retry-After (default 60s), clamped to a sane maximum. Anything else rethrows.
export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OnshapeApiError && error.status === 429) {
      const waitSeconds = Math.min(
        error.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_WAIT_SECONDS,
        RATE_LIMIT_MAX_WAIT_SECONDS
      );
      throw new RetryAfterError(
        `onshape: rate limited on ${label}; retrying after ${waitSeconds}s`,
        waitSeconds * 1000,
        { cause: error }
      );
    }
    throw error;
  }
}
