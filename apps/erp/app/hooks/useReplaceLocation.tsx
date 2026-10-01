// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useOptimisticLocation } from "@carbon/react";
import { useCallback, useState } from "react";
import type { Location } from "react-router";

export function useReplaceLocation() {
  const optimisticLocation = useOptimisticLocation();
  const [location, setLocation] = useState(optimisticLocation);

  const replaceLocation = useCallback((location: Location<any>) => {
    const fullPath = location.pathname + location.search + location.hash;
    //replace the URL in the browser
    history.replaceState(null, "", fullPath);
    //update the state (new object in case the same location ref was modified)
    const newLocation = { ...location };
    setLocation(newLocation);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const replaceSearchParam = useCallback(
    (key: string, value?: string) => {
      const searchParams = new URLSearchParams(location.search);
      if (value) {
        searchParams.set(key, value);
      } else {
        searchParams.delete(key);
      }
      replaceLocation({
        ...optimisticLocation,
        search: "?" + searchParams.toString()
      });
    },
    [optimisticLocation, replaceLocation]
  );

  return { location, replaceLocation, replaceSearchParam };
}
