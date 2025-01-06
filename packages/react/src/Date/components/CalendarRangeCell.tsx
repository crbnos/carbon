import type { CalendarDate } from "@internationalized/date";
import {
  getLocalTimeZone,
  isToday as isDateToday,
  isSameDay,
  isSameMonth,
} from "@internationalized/date";
import { useCalendarCell } from "@react-aria/calendar";
import type { RangeCalendarState } from "@react-stately/calendar";
import clsx from "clsx";
import { useRef } from "react";

import { Button } from "../../Button";

export function CalendarRangeCell({
  state,
  date,
  currentMonth,
  ...props
}: {
  state: RangeCalendarState;
  date: CalendarDate;
  currentMonth: CalendarDate;
  isRangeCalendar?: boolean;
  locale?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const {
    cellProps,
    buttonProps,
    isSelected,
    isInvalid,
    isDisabled,
    isUnavailable,
    isFocused,
    formattedDate,
  } = useCalendarCell({ date }, state, ref);

  const isOutsideMonth = !isSameMonth(currentMonth, date);
  const isToday = isDateToday(date, getLocalTimeZone());

  const isSelectionStart = state.highlightedRange
    ? isSameDay(date, state.highlightedRange.start)
    : isSelected;
  const isSelectionEnd = state.highlightedRange
    ? isSameDay(date, state.highlightedRange.end)
    : isSelected;

  const isRoundedLeft = isSelected && isSelectionStart;
  const isRoundedRight = isSelected && isSelectionEnd;

  return (
    <td className="text-center relative" {...cellProps}>
      <Button
        {...buttonProps}
        ref={ref}
        size="sm"
        variant={isSelected ? "primary" : "ghost"}
        className={clsx(
          "p-0 w-8 h-8 shadow-none font-normal hover:primary/10",
          {
            "bg-primary/50": isFocused,
            "bg-primary text-card hover:bg-primary": isSelected,
            "opacity-50 hover:bg-card focus:bg-card":
              isInvalid || isDisabled || isUnavailable,
            "hover:rounded-full": !isSelected,
            hidden: isOutsideMonth,
            "rounded-none": isSelected && !isRoundedLeft && !isRoundedRight,
            "!rounded-l-full !rounded-r-none": isRoundedLeft,
            "!rounded-r-full !rounded-l-none": isRoundedRight,
            "!rounded-full":
              (isFocused && !isSelected) ||
              (isSelected && isRoundedLeft && isRoundedRight),
          }
        )}
      >
        {formattedDate}
      </Button>
      {isToday && (
        <span
          className={clsx(
            "absolute w-1 h-1 bottom-1 rounded-full left-1/2 transform -translate-x-1/2",
            {
              "bg-card": isSelected,
              "bg-primary ": !isSelected,
            }
          )}
        />
      )}
    </td>
  );
}
