// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Edition } from "@carbon/utils";
import { useRouteData } from "./useRouteData";

export function useEdition() {
  const routeData = useRouteData<{ env: { CARBON_EDITION: Edition } }>("/");
  return routeData?.env?.CARBON_EDITION ?? Edition.Community;
}
