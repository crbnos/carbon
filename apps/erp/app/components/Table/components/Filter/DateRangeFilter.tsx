// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DatePicker, useDebounce } from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { formatRangeFilter, parseRangeFilter } from "~/utils/query";
import { useFilters } from "./useFilters";

type DateRange = {
  from: CalendarDate | null;
  to: CalendarDate | null;
};

function toCalendarDate(value: string | null): CalendarDate | null {
  if (!value) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

type DateRangeFilterProps = {
  accessorKey: string;
};

const DateRangeFilter = ({ accessorKey }: DateRangeFilterProps) => {
  const { t } = useLingui();
  const { getFilterValue, removeKey, setFilter } = useFilters();

  const [range, setRange] = useState<DateRange>(() => {
    const { from, to } = parseRangeFilter(getFilterValue(accessorKey) ?? "");
    return { from: toCalendarDate(from), to: toCalendarDate(to) };
  });

  const apply = ({ from, to }: DateRange) => {
    // From after To is flagged on the pickers and never reaches the URL
    if (from && to && from.compare(to) > 0) return;
    const value = formatRangeFilter(from?.toString(), to?.toString());
    // Already what the URL says — closing the popover replays the last change
    if (value === getFilterValue(accessorKey)) return;
    if (value) {
      setFilter(accessorKey, value, "between");
    } else {
      removeKey(accessorKey);
    }
  };

  // A typed date emits every intermediate keystroke, so wait for it to
  // settle. The ref keeps the delayed call (and the flush on close) on the
  // current URL rather than the one from the render that scheduled it.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const debouncedApply = useDebounce(
    (next: DateRange) => applyRef.current(next),
    400,
    true
  );

  const onChange = (next: DateRange) => {
    setRange(next);
    debouncedApply(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          <Trans>From</Trans>
        </span>
        <DatePicker
          aria-label={t`From`}
          size="sm"
          closeOnSelect
          value={range.from}
          maxValue={range.to ?? undefined}
          onChange={(from) => onChange({ ...range, from })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          <Trans>To</Trans>
        </span>
        <DatePicker
          aria-label={t`To`}
          size="sm"
          closeOnSelect
          value={range.to}
          minValue={range.from ?? undefined}
          onChange={(to) => onChange({ ...range, to })}
        />
      </div>
    </div>
  );
};

export default DateRangeFilter;
