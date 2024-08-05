import type { DateDuration } from "@internationalized/date";
import { endOfMonth, getWeeksInMonth } from "@internationalized/date";
import { useCalendarGrid } from "@react-aria/calendar";
import { useLocale } from "@react-aria/i18n";
import type {
  CalendarState,
  RangeCalendarState,
} from "@react-stately/calendar";
import { Table, Tbody, Td, Th, Thead, Tr } from "../../Table";
import { CalendarCell } from "./CalendarCell";

export const CalendarGrid = ({
  state,
  offset = {},
}: {
  state: CalendarState | RangeCalendarState;
  offset?: DateDuration;
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
    <Table {...gridProps}>
      <Thead {...headerProps}>
        <Tr>
          {weekDays.map((day, index) => (
            <Th
              key={index}
              className="text-muted-foreground text-sm text-center px-0"
            >
              {day}
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {[...new Array(weeksInMonth).keys()].map((weekIndex) => (
          <Tr key={weekIndex} className="border-none">
            {state
              .getDatesInWeek(weekIndex, startDate)
              .map((date, i) =>
                date ? (
                  <CalendarCell
                    key={i}
                    state={state}
                    date={date}
                    currentMonth={startDate}
                  />
                ) : (
                  <Td key={i} />
                )
              )}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
};
