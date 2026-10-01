// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useRouteData } from "@carbon/react";
import { path } from "~/utils/path";

export function useSettings(): Database["public"]["Tables"]["companySettings"]["Row"] {
  const routeData = useRouteData<{
    companySettings: Database["public"]["Tables"]["companySettings"]["Row"];
  }>(path.to.authenticatedRoot);

  if (!routeData?.companySettings) {
    throw new Error("Company settings not found");
  }

  return routeData.companySettings;
}
