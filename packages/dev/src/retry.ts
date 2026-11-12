// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  {
    attempts = 4,
    retryIf = () => true,
    onRetry
  }: {
    attempts?: number;
    /** False for an error no wait will fix: it is thrown at once. */
    retryIf?: (error: unknown) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !retryIf(error)) throw error;
      const backoffMs = 5000 * 3 ** (attempt - 1);
      const delayMs = backoffMs / 2 + Math.random() * (backoffMs / 2);
      onRetry?.(error, attempt, delayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
