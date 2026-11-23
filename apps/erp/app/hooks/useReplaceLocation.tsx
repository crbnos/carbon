// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useOptimisticLocation } from "@carbon/react";
import { useCallback, useState } from "react";
import type { Location } from "react-router";

/**
 * Change the URL's search params without a navigation (no loader runs). The
 * router does not see a `history.replaceState`, so the replaced location is
 * kept, keyed by the router's history entry, until the router moves to
 * another entry. Each change starts from the address bar and the history
 * entry as they are when it runs, so two quick changes (a debounced one among
 * them) never drop each other's params, and a debounced change that fires
 * after a navigation is recorded against the new entry, not the one it was
 * scheduled on.
 */
export function useReplaceLocation() {
  const optimisticLocation = useOptimisticLocation();
  const [replaced, setReplaced] = useState<Location<any> | null>(null);
  const location =
    replaced?.key === optimisticLocation.key ? replaced : optimisticLocation;

  const replaceLocation = useCallback((next: Location<any>) => {
    // Keep the router's own history entry state ({ usr, key, idx }).
    history.replaceState(
      history.state,
      "",
      next.pathname + next.search + next.hash
    );
    // The router names a location by its history entry's key.
    setReplaced({ ...next, key: history.state?.key ?? "default" });
  }, []);

  const replaceSearchParam = useCallback(
    (key: string, value?: string) => {
      const searchParams = new URLSearchParams(window.location.search);
      if (value) {
        searchParams.set(key, value);
      } else {
        searchParams.delete(key);
      }
      replaceLocation({
        pathname: window.location.pathname,
        search: "?" + searchParams.toString(),
        hash: window.location.hash,
        state: history.state?.usr ?? null,
        key: history.state?.key ?? "default"
      });
    },
    [replaceLocation]
  );

  return { location, replaceLocation, replaceSearchParam };
}
