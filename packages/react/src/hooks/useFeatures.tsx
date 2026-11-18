// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "./useRouteData";

/** The server's answer per feature (`getEntitledFeatures`), from the `/x` loader. */
export function useFeatures(): Record<string, boolean> {
  const routeData = useRouteData<{ features?: Record<string, boolean> }>("/x");
  return routeData?.features ?? {};
}
