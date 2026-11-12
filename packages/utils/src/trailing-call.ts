// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Calls `onDue` with the latest scheduled value once `delayMs` pass with no
 * newer one. `take` cancels the call and hands back the value still pending,
 * so a caller can save it another way (on close).
 */
export function createTrailingCall<T>(
  delayMs: number,
  onDue: (value: T) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | undefined;

  const take = () => {
    clearTimeout(timer);
    timer = undefined;
    const taken = pending;
    pending = undefined;
    return taken?.value;
  };

  return {
    schedule(value: T) {
      pending = { value };
      clearTimeout(timer);
      timer = setTimeout(() => {
        const value = take();
        if (value !== undefined) onDue(value);
      }, delayMs);
    },
    take,
    isPending: () => pending !== undefined
  };
}
