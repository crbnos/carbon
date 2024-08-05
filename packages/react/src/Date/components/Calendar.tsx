import type { CalendarDate, DateValue } from "@internationalized/date";
import { createCalendar } from "@internationalized/date";
import type { CalendarProps } from "@react-aria/calendar";
import { useCalendar } from "@react-aria/calendar";
import { useLocale } from "@react-aria/i18n";
import { useCalendarState } from "@react-stately/calendar";
import { useMemo, useRef } from "react";
import { BiChevronLeft, BiChevronRight } from "react-icons/bi";
import { Heading } from "../../Heading";
import { CalendarButton } from "./Button";
import { CalendarGrid } from "./CalendarGrid";

export const Calendar = (props: CalendarProps<DateValue>) => {
  const { locale } = useLocale();
  const state = useCalendarState({
    ...props,
    locale,
    createCalendar,
  });

  const ref = useRef<HTMLDivElement>(null);
  const { calendarProps, prevButtonProps, nextButtonProps } = useCalendar(
    props,
    state
  );

  const title = useLocalizedTitle(
    state.visibleRange.start,
    state.visibleRange.end,
    state.timeZone,
    locale
  );

  return (
    <div {...calendarProps} ref={ref}>
      <div className="flex items-center pb-4">
        <CalendarButton
          {...prevButtonProps}
          icon={<BiChevronLeft />}
          aria-label="Previous"
        />

        <Heading as="h2" size="h3" className="flex-1 text-center">
          {title}
        </Heading>
        <CalendarButton
          {...nextButtonProps}
          icon={<BiChevronRight />}
          aria-label="Next"
        />
      </div>
      <CalendarGrid state={state} />
    </div>
  );
};

function useLocalizedTitle(
  startDate: CalendarDate,
  endDate: CalendarDate,
  timeZone: string,
  locale: string
) {
  const dateFormatter = useMemo(() => {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    });
  }, [locale]);

  return dateFormatter.format(startDate.toDate(timeZone));
}
