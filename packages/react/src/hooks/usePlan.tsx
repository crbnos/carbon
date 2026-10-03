// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { normalizePlanId, type Plan } from "@carbon/utils";
import { useRouteData } from "./useRouteData";

export function usePlan(): Plan {
  const routeData = useRouteData<{ plan?: string | null }>("/x");
  return normalizePlanId(routeData?.plan);
}
