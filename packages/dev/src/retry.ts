// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  {
    attempts = 4,
    initialDelayMs = 5000,
    factor = 3,
    onRetry
  }: {
    attempts?: number;
    initialDelayMs?: number;
    factor?: number;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts) throw error;
      const backoffMs = initialDelayMs * factor ** (attempt - 1);
      const delayMs = backoffMs / 2 + Math.random() * (backoffMs / 2);
      onRetry?.(error, attempt, delayMs);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
