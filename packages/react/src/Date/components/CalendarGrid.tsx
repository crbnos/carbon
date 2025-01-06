import type { DateDuration } from "@internationalized/date";
import { endOfMonth, getWeeksInMonth } from "@internationalized/date";
import { useCalendarGrid } from "@react-aria/calendar";
import { useLocale } from "@react-aria/i18n";
import type {
  CalendarState,
  RangeCalendarState,
} from "@react-stately/calendar";
import { CalendarCell } from "./CalendarCell";
import { CalendarRangeCell } from "./CalendarRangeCell";

export const CalendarGrid = ({
  state,
  offset = {},
  isRangeCalendar = false,
}: {
  state: CalendarState | RangeCalendarState;
  offset?: DateDuration;
  isRangeCalendar?: boolean;
}) => {
  const { locale } = useLocale();
  const startDate = state.visibleRange.start.add(offset);
  const endDate = endOfMonth(startDate);
  const { gridProps, headerProps, weekDays } = useCalendarGrid(
    {
      startDate,
      endDate,
    },
    state
  );

  // Get the number of weeks in the month so we can render the proper number of rows.
  const weeksInMonth = getWeeksInMonth(state.visibleRange.start, locale);

  return (
    <table
      {...gridProps}
      className="w-full border-collapse space-y-1"
      cellPadding={isRangeCalendar ? "0" : undefined}
    >
      <thead {...headerProps}>
        <tr>
          {weekDays.map((day, index) => (
            <th
              className="text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]"
              key={index}
            >
              {day}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...new Array(weeksInMonth).keys()].map((weekIndex) => (
          <tr key={weekIndex} className="h-9">
            {state
              .getDatesInWeek(weekIndex, startDate)
              .map((date, i) =>
                date ? (
                  isRangeCalendar ? (
                    <CalendarRangeCell
                      key={i}
                      state={state as RangeCalendarState}
                      date={date}
                      currentMonth={startDate}
                      locale={locale}
                    />
                  ) : (
                    <CalendarCell
                      key={i}
                      state={state as CalendarState}
                      date={date}
                      currentMonth={startDate}
                    />
                  )
                ) : (
                  <td key={i} />
                )
              )}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
