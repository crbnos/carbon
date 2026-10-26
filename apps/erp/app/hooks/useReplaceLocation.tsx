// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useOptimisticLocation } from "@carbon/react";
import { useCallback, useState } from "react";
import type { Location } from "react-router";

/**
 * Change the URL's search params without a navigation (no loader runs). The
 * router does not see a `history.replaceState`, so the replaced location is
 * kept until the router moves to another location. Each change starts from
 * the address bar as it is when the change runs, so two quick changes (a
 * debounced one among them) never drop each other's params.
 */
export function useReplaceLocation() {
  const optimisticLocation = useOptimisticLocation();
  const [replaced, setReplaced] = useState<{
    key: string;
    location: Location<any>;
  } | null>(null);
  const location =
    replaced?.key === optimisticLocation.key
      ? replaced.location
      : optimisticLocation;

  const replaceLocation = useCallback(
    (next: Location<any>) => {
      // Keep the router's own history entry state ({ usr, key, idx }).
      history.replaceState(
        history.state,
        "",
        next.pathname + next.search + next.hash
      );
      setReplaced({ key: optimisticLocation.key, location: { ...next } });
    },
    [optimisticLocation.key]
  );

  const replaceSearchParam = useCallback(
    (key: string, value?: string) => {
      const searchParams = new URLSearchParams(window.location.search);
      if (value) {
        searchParams.set(key, value);
      } else {
        searchParams.delete(key);
      }
      replaceLocation({ ...location, search: "?" + searchParams.toString() });
    },
    [location, replaceLocation]
  );

  return { location, replaceLocation, replaceSearchParam };
}
