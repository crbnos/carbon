// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useMemo } from "react";
import { useMatches } from "react-router";

export function useRouteData<T>(path: string): T | undefined {
  const matchingRoutes = useMatches();
  const route = useMemo(
    () => matchingRoutes.find((route) => route.pathname === path),
    [matchingRoutes, path]
  );
  return (route?.data as T) || undefined;
}
