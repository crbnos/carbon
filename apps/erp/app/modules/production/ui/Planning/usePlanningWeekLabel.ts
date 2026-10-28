// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import { useCompanySettings } from "~/hooks";
import { planningWeekNumber } from "./planning-week-number";

/**
 * The heading of the planning week starting `startDate`, at position `index`
 * from today: "Present Week", "Week 2", … or, by calendar week, "Week 44",
 * "Week 45", …. One function for the planning grids, the week strip and Demand
 * Forecasts, so they can never head the same week two ways.
 */
export function usePlanningWeekLabel() {
  const { t } = useLingui();
  const useCalendarWeeks = useCompanySettings()?.useCalendarWeeks ?? false;
  return useCallback(
    (startDate: string, index: number) => {
      if (!useCalendarWeeks && index === 0) return t`Present Week`;
      const weekNumber = planningWeekNumber(startDate, index, useCalendarWeeks);
      return t`Week ${weekNumber}`;
    },
    [t, useCalendarWeeks]
  );
}
