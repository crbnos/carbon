// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useState } from "react";

const settled = new WeakMap<Promise<unknown>, unknown>();

// Unwraps a promise a loader streamed instead of awaiting, keeping the last
// value while a revalidation's replacement is pending. Pass the record id as
// `scope` when the component stays mounted across records: a new scope drops
// the last value, so one record never shows another's.
export function useResolved<T>(
  promise: Promise<T> | null | undefined,
  fallback: T,
  scope?: string
): T {
  const initial = () =>
    promise && settled.has(promise) ? (settled.get(promise) as T) : fallback;
  const [state, setState] = useState(() => ({ scope, value: initial() }));

  useEffect(() => {
    if (!promise) return;
    let active = true;
    promise.then(
      (resolved) => {
        settled.set(promise, resolved);
        if (active) setState({ scope, value: resolved });
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, [promise, scope]);

  return state.scope === scope ? state.value : initial();
}
