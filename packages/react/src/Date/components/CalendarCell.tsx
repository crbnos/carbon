// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CalendarDate } from "@internationalized/date";
import {
  getLocalTimeZone,
  isToday as isDateToday,
  isSameMonth
} from "@internationalized/date";
import { useCalendarCell } from "@react-aria/calendar";
import type {
  CalendarState,
  RangeCalendarState
} from "@react-stately/calendar";
import clsx from "clsx";
import { useRef } from "react";
import { Button } from "../../Button";
import { Td } from "../../Table";

export const CalendarCell = ({
  state,
  date,
  currentMonth,
  isMarked = false
}: {
  state: CalendarState | RangeCalendarState;
  date: CalendarDate;
  currentMonth: CalendarDate;
  isMarked?: boolean;
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const {
    cellProps,
    buttonProps,
    isSelected,
    isInvalid,
    isDisabled,
    isUnavailable,
    isFocused,
    formattedDate
  } = useCalendarCell({ date }, state, ref);

  const isOutsideMonth = !isSameMonth(currentMonth, date);
  const isToday = isDateToday(date, getLocalTimeZone());

  return (
    <Td {...cellProps} className="border-none text-center p-1 relative">
      <Button
        {...buttonProps}
        ref={ref}
        className={clsx("w-8 h-8 rounded-full hover:bg-muted", {
          "opacity-50 disabled:cursor-not-allowed": isDisabled,
          "bg-destructive text-destructive-foreground": isInvalid,
          "bg-muted": isFocused,
          "bg-primary text-primary-foreground hover:bg-primary": isSelected,
          "opacity-50 hover:bg-white focus:bg-white":
            isInvalid || isDisabled || isUnavailable,
          hidden: isOutsideMonth
        })}
        variant={isSelected ? "primary" : "ghost"}
        style={{
          opacity: isOutsideMonth
            ? 0.25
            : isInvalid || isDisabled || isUnavailable
              ? 0.5
              : 1
        }}
      >
        {formattedDate}
      </Button>
      {(isToday || isMarked) && !isOutsideMonth && (
        <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5 pointer-events-none">
          {isToday && (
            <span
              className={clsx("w-1 h-1 rounded-full", {
                "bg-primary-foreground": isSelected,
                "bg-primary": !isSelected
              })}
            />
          )}
          {isMarked && (
            <span
              className={clsx("w-1 h-1 rounded-full", {
                "bg-primary-foreground/70": isSelected,
                "bg-muted-foreground": !isSelected
              })}
            />
          )}
        </span>
      )}
    </Td>
  );
};
