// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { planningGroupExcessRules } from "../../projects.models";

type PlanningGroupExcessRule = (typeof planningGroupExcessRules)[number];

/** The translated label of each excess rule. The enum value "Common Stock" reads as "Unassigned stock". */
export function usePlanningGroupExcessRuleLabels(): Record<
  PlanningGroupExcessRule,
  string
> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      "Common Stock": t`Unassigned stock`,
      "Exception Project": t`Exception project`
    }),
    [t]
  );
}
