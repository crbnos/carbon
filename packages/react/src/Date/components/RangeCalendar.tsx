import type { CalendarDate, DateValue } from "@internationalized/date";
import { createCalendar } from "@internationalized/date";
import type { RangeCalendarProps } from "@react-aria/calendar";
import { useRangeCalendar } from "@react-aria/calendar";
import { useLocale } from "@react-aria/i18n";
import { useRangeCalendarState } from "@react-stately/calendar";
import { useEffect, useMemo, useRef } from "react";

import clsx from "clsx";
import {
  LuChevronLeft,
  LuChevronRight,
  LuChevronsLeft,
  LuChevronsRight,
} from "react-icons/lu";
import { CalendarButton } from "./Button";
import { CalendarGrid } from "./CalendarGrid";

export function RangeCalendar({
  bordered = false,
  ...props
}: RangeCalendarProps<DateValue> & {
  locale?: string;
  bordered?: boolean;
  className?: string;
}) {
  const { locale } = useLocale();
  const state = useRangeCalendarState({
    ...props,
    visibleDuration: { months: 2 },
    locale,
    createCalendar,
  });

  useEffect(() => {
    if (!props.value?.start) return;
    state.setFocusedDate(props.value.start as CalendarDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  const ref = useRef<HTMLDivElement>(null);
  const { calendarProps, prevButtonProps, nextButtonProps } = useRangeCalendar(
    props,
    state,
    ref
  );

  const startTitle = useLocalizedTitle(
    state.visibleRange.start,
    state.timeZone,
    locale
  );
  const endTitle = useLocalizedTitle(
    state.visibleRange.end,
    state.timeZone,
    locale
  );

  // Note that in some calendar systems, such as the Hebrew,
  // the number of months may differ between years.
  const numMonths = state.focusedDate.calendar.getMonthsInYear(
    state.focusedDate
  );

  const handlePrevYear = () => {
    state.setFocusedDate(
      state.visibleRange.start.subtract({ months: numMonths - 1 })
    );
  };

  const handleNextYear = () => {
    state.setFocusedDate(state.visibleRange.start.add({ years: 1 }));
  };

  return (
    <div {...calendarProps} ref={ref} className="flex">
      <div
        className={clsx("p-4 border-r border-border", {
          "rounded-md border shadow": bordered,
        })}
      >
        <div className="flex items-center pb-4">
          <CalendarButton
            onClick={handlePrevYear}
            aria-label="Previous Year"
            className="rounded-full"
            icon={<LuChevronsLeft />}
            size="sm"
            variant="ghost"
          />
          <CalendarButton
            {...prevButtonProps}
            aria-label="Previous Month"
            className="rounded-full"
            icon={<LuChevronLeft />}
            size="sm"
            variant="ghost"
          />
          <div className="font-semibold text-left text-base flex-1 pl-2">
            {startTitle}
          </div>
        </div>
        <div className="flex gap-8">
          <CalendarGrid state={state} isRangeCalendar />
        </div>
      </div>
      <div
        className={clsx("p-4 ", {
          "rounded-md border shadow": bordered,
        })}
      >
        <div className="flex items-center pb-4">
          <div className="font-semibold text-right text-base flex-1 pr-2">
            {endTitle}
          </div>
          <CalendarButton
            {...nextButtonProps}
            aria-label="Next Month"
            className="rounded-full"
            icon={<LuChevronRight />}
            size="sm"
            variant="ghost"
          />
          <CalendarButton
            onClick={handleNextYear}
            aria-label="Next Year"
            className="rounded-full"
            icon={<LuChevronsRight />}
            size="sm"
            variant="ghost"
          />
        </div>
        <div className="flex gap-8">
          <CalendarGrid state={state} offset={{ months: 1 }} isRangeCalendar />
        </div>
      </div>
    </div>
  );
}

function useLocalizedTitle(
  date: CalendarDate,
  timeZone: string,
  locale: string
) {
  const dateFormatter = useMemo(() => {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    });
  }, [locale]);

  return dateFormatter.format(date.toDate(timeZone));
}
