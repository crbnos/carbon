// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";

/**
 * The number a planning week is headed with. Counted from today (the present
 * week is 1, next week 2) unless the company plans by calendar week
 * (`companySettings.useCalendarWeeks`), when it is the ISO 8601 week of the
 * year. A period runs Sunday to Saturday (`getOrCreatePeriods`); its ISO week
 * is read three days in, which is in the same ISO week whether the period
 * starts on a Sunday or a Monday.
 */
export function planningWeekNumber(
  startDate: string,
  index: number,
  useCalendarWeeks: boolean
): number {
  if (!useCalendarWeeks) return index + 1;
  return datetime.weekNumber(parseDate(startDate).add({ days: 3 }));
}
