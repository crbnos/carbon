// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRouteData } from "@carbon/react";
import { useEffect, useState } from "react";
import { path } from "~/utils/path";

export function useSupplierApprovalRequired(): boolean {
  const routeData = useRouteData<{
    supplierApprovalRequired: Promise<boolean>;
  }>(path.to.authenticatedRoot);
  const [value, setValue] = useState(false);

  useEffect(() => {
    routeData?.supplierApprovalRequired
      ?.then((v) => setValue(!!v))
      ?.catch(() => {
        // swallow rejection — surfaces as default `false`
      });
  }, [routeData?.supplierApprovalRequired]);

  return value;
}
