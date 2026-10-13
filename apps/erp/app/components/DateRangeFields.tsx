// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, DatePicker } from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";

export type DateRangeValue = {
  from: CalendarDate | null;
  to: CalendarDate | null;
};

type DateRangeFieldsProps = {
  /** Read once on mount; the fields hold the draft from then on. */
  defaultValue?: DateRangeValue;
  /**
   * Called on every change. `null` while From is after To: there is nothing
   * to apply, and the caller keeps its last range. It is still a change, so a
   * debounced caller restarts its timer instead of firing a value typed on the
   * way to the invalid one.
   */
  onChange: (value: DateRangeValue | null) => void;
  /** `stacked` for a popover, `inline` for a toolbar. */
  layout?: "stacked" | "inline";
  /** Open the From calendar on mount, for a control the user just picked. */
  autoOpen?: boolean;
  /** Days to flag with a dot in both calendars. */
  isDateMarked?: (date: CalendarDate) => boolean;
  className?: string;
};

/**
 * From / To date pickers. Either side may be left empty for an open-ended
 * range ("on or after" / "on or before"); both bounds are inclusive.
 */
const DateRangeFields = ({
  defaultValue,
  onChange,
  layout = "stacked",
  autoOpen = false,
  isDateMarked,
  className
}: DateRangeFieldsProps) => {
  const { t } = useLingui();
  const [range, setRange] = useState<DateRangeValue>(
    () => defaultValue ?? { from: null, to: null }
  );

  const update = (next: DateRangeValue) => {
    setRange(next);
    // From after To is flagged on the pickers and is never applied
    const isValid = !(next.from && next.to && next.from.compare(next.to) > 0);
    onChange(isValid ? next : null);
  };

  const inline = layout === "inline";
  const labelClassName = "text-xs text-muted-foreground";
  const fieldClassName = inline
    ? "flex items-center gap-2"
    : "flex flex-col gap-1";
  const pickerClassName = inline ? "w-[150px]" : undefined;

  return (
    <div
      className={cn(
        inline ? "flex items-center gap-3" : "flex flex-col gap-2",
        className
      )}
    >
      <div className={fieldClassName}>
        <span className={labelClassName}>
          <Trans>From</Trans>
        </span>
        <div className={pickerClassName}>
          <DatePicker
            aria-label={t`From`}
            size="sm"
            closeOnSelect
            defaultOpen={autoOpen}
            value={range.from}
            maxValue={range.to ?? undefined}
            isDateMarked={isDateMarked}
            onChange={(from) => update({ ...range, from })}
          />
        </div>
      </div>
      <div className={fieldClassName}>
        <span className={labelClassName}>
          <Trans>To</Trans>
        </span>
        <div className={pickerClassName}>
          <DatePicker
            aria-label={t`To`}
            size="sm"
            closeOnSelect
            value={range.to}
            minValue={range.from ?? undefined}
            isDateMarked={isDateMarked}
            onChange={(to) => update({ ...range, to })}
          />
        </div>
      </div>
    </div>
  );
};

export default DateRangeFields;
