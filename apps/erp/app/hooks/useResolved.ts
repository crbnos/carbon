// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useState } from "react";

const settled = new WeakMap<Promise<unknown>, unknown>();

// Unwraps a promise a loader streamed instead of awaiting, keeping the last
// value while a revalidation's replacement is pending.
export function useResolved<T>(
  promise: Promise<T> | null | undefined,
  fallback: T
): T {
  const [value, setValue] = useState<T>(() =>
    promise && settled.has(promise) ? (settled.get(promise) as T) : fallback
  );

  useEffect(() => {
    if (!promise) return;
    let active = true;
    promise.then(
      (resolved) => {
        settled.set(promise, resolved);
        if (active) setValue(resolved);
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [promise]);

  return value;
}
