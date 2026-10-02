// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { path } from "~/utils/path";
import { useResolved } from "./useResolved";

export function useSupplierApprovalRequired(): boolean {
  const routeData = useRouteData<{
    supplierApprovalRequired: Promise<boolean>;
  }>(path.to.authenticatedRoot);
  return !!useResolved(routeData?.supplierApprovalRequired, false);
}
