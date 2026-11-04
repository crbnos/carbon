// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { ProjectStockTransferType } from "../../projects.models";

/** The translated name of each project stock transfer type. */
export function useStockTransferTypeLabels() {
  const { t } = useLingui();
  return useMemo<Record<ProjectStockTransferType, string>>(
    () => ({
      Transfer: t`Transfer`,
      Borrow: t`Borrow`,
      Payback: t`Payback`
    }),
    [t]
  );
}
