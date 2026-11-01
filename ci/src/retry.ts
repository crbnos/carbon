// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `run` until it succeeds, up to `attempts` times. Each wait is a random
 * time between 0 and `baseMs × 2^n` ("full jitter"): several deploys that fail
 * together retry at different moments instead of colliding again.
 */
export async function withRetry<T>(
  run: () => Promise<T>,
  {
    attempts = 6,
    baseMs = 2000,
    wait = sleep,
    random = Math.random
  }: {
    attempts?: number;
    baseMs?: number;
    wait?: (ms: number) => Promise<unknown>;
    random?: () => number;
  } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await wait(random() * baseMs * 2 ** (attempt - 1));
    }
  }
}
