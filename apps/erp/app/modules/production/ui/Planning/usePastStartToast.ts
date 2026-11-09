// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

/**
 * The toast for a Make / Order that refused the orders starting before today
 * and placed the rest; shared by both planning drawers and both grids.
 */
export function usePastStartToast() {
  const { t } = useLingui();
  return (created: number, refused: number) => {
    const late = t`${plural(refused, {
      one: "# order starts before today and was not created. Reschedule it from today.",
      other:
        "# orders start before today and were not created. Reschedule them from today."
    })}`;
    return `${t`${created} created.`} ${late}`;
  };
}
