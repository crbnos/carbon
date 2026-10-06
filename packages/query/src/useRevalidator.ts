// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useFetchers,
  useNavigation,
  useRevalidator as useRouterRevalidator
} from "react-router";

// A revalidation asked for while the router was busy. Module state, not a ref:
// the component that asked (a modal, a row menu) is often gone by the time the
// router is idle, and any mounted caller of the hook can run it then.
let held = false;

/**
 * `useRevalidator` whose `revalidate` never starts during a save. Import this
 * one, never React Router's (the `no-raw-revalidator` check enforces it).
 *
 * A revalidation that starts during a save does harm twice over:
 * - during the action, React Router drops the fetcher's redirect;
 * - during the navigation that follows the save, it restarts that navigation
 *   without the submission. The restarted one looks like a plain navigation,
 *   so every layout whose `shouldRevalidate` skips those keeps its data from
 *   before the save (a new quote line was missing from the quote's explorer
 *   until a reload: the save's own realtime broadcast arrived mid-redirect).
 *
 * A call made while a fetcher is submitting or a navigation is in flight is
 * held and runs once the router is idle. The promise of a held call resolves
 * at once, before that reload: awaiting it does not wait for the data.
 */
export function useRevalidator() {
  const { revalidate: routerRevalidate, state } = useRouterRevalidator();
  const navigating = useNavigation().state !== "idle";
  const submitting = useFetchers().some((f) => f.state === "submitting");
  const busy = navigating || submitting;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const revalidate = useCallback(async () => {
    if (busyRef.current) {
      held = true;
      return;
    }
    await routerRevalidate();
  }, [routerRevalidate]);

  useEffect(() => {
    if (!busy && held) {
      held = false;
      void routerRevalidate();
    }
  }, [busy, routerRevalidate]);

  return useMemo(() => ({ revalidate, state }), [revalidate, state]);
}
