// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";

/**
 * The toast for a Make / Order that refused the orders starting before today
 * and placed the rest; shared by both planning drawers and both grids.
 */
export function usePastStartToast() {
  const { t } = useLingui();
  return useCallback(
    (created: number, refused: number) => {
      const late =
        refused === 1
          ? t`1 order starts before today and was not created. Reschedule it from today.`
          : t`${refused} orders start before today and were not created. Reschedule them from today.`;
      if (created === 0) return late;
      const placed = created === 1 ? t`1 created.` : t`${created} created.`;
      return `${placed} ${late}`;
    },
    [t]
  );
}
