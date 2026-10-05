// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  DatePicker,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo, useCallback, useMemo, useState } from "react";
import { effectiveFenceDate } from "./planning-fence";

// The planning horizon (time fence) on the planning grids. A row surfaces only
// the actions and suggested orders that fall on or before its fence date —
// today plus the item's saved planning horizon. A planner can move one row's
// fence on screen to look further out (or closer in); that lives in page state
// only, never on the item, and is gone after a reload.

export type FenceRow = { id: string; timeFenceDate: string | null };

/**
 * Per-row fence overrides, keyed by item id. `fenceDateFor` is the row's
 * effective fence: the override when there is one, else the saved horizon.
 */
export function useTimeFenceOverrides() {
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const setFenceDate = useCallback((itemId: string, date: string | null) => {
    setOverrides((prev) => {
      if (date === null) {
        if (!(itemId in prev)) return prev;
        const { [itemId]: _removed, ...rest } = prev;
        return rest;
      }
      if (prev[itemId] === date) return prev;
      return { ...prev, [itemId]: date };
    });
  }, []);

  return useMemo(
    () => ({
      overrides,
      setFenceDate,
      fenceDateFor: (row: FenceRow) =>
        effectiveFenceDate(row.timeFenceDate, overrides[row.id]),
      isOverridden: (row: FenceRow) =>
        row.id in overrides && overrides[row.id] !== row.timeFenceDate
    }),
    [overrides, setFenceDate]
  );
}

/**
 * The grid's Time Fence cell: the row's fence date with a calendar to move it.
 * Clearing the picker drops the override and returns to the saved horizon.
 */
export const TimeFenceCell = memo(function TimeFenceCell({
  fenceDate,
  isOverridden,
  onChange
}: {
  fenceDate: string | null;
  isOverridden: boolean;
  /** `null` = drop the override (back to the item's saved horizon). */
  onChange: (date: string | null) => void;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();

  return (
    <DatePicker
      aria-label={t`Time fence`}
      closeOnSelect
      value={fenceDate ? parseDate(fenceDate) : null}
      onChange={(value) => onChange(value ? value.toString() : null)}
      helperText={
        isOverridden
          ? t`Changed for this view only. The item's planning horizon is not updated.`
          : undefined
      }
      inline={
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            !fenceDate && "text-muted-foreground",
            isOverridden && "font-medium"
          )}
        >
          {fenceDate ? formatDate(fenceDate, undefined, locale) : t`None`}
        </span>
      }
    />
  );
});

/**
 * The start of the first week the projected on-hand goes below zero — when a
 * reschedule has to land by. Red once that week has started.
 */
export const FirstNegativeDateCell = memo(function FirstNegativeDateCell({
  date,
  todayIso
}: {
  date: string | null;
  todayIso: string;
}) {
  const { locale } = useLocale();
  if (!date) return <span>-</span>;

  const isDue = date <= todayIso;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            isDue && "text-red-500 font-bold"
          )}
        >
          {formatDate(date, undefined, locale)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {isDue ? (
          <Trans>Projected stock is already below zero this week</Trans>
        ) : (
          <Trans>First week the projected stock goes below zero</Trans>
        )}
      </TooltipContent>
    </Tooltip>
  );
});
