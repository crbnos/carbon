// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CalendarDate } from "@internationalized/date";
import { useDateRangePicker } from "@react-aria/datepicker";
import { useDateRangePickerState } from "@react-stately/datepicker";
import type { DateRangePickerProps, DateValue } from "@react-types/datepicker";
import { cva } from "class-variance-authority";
import { useRef } from "react";
import { LuBan } from "react-icons/lu";
import { HStack } from "../HStack";
import { InputGroup } from "../Input";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";
import { FieldButton } from "./components/Button";
import DateField from "./components/DateField";
import { RangeCalendar } from "./components/RangeCalendar";

const iconVariants = cva("", {
  variants: {
    size: {
      sm: "h-3 w-3",
      md: "h-4 w-4",
      lg: "h-5 w-5"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

const fieldVariants = cva("flex w-full", {
  variants: {
    size: {
      sm: "px-2 py-1",
      md: "px-4 py-2",
      lg: "px-6 py-3"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

const DateRangePicker = ({
  size = "md",
  isDateMarked,
  ...props
}: DateRangePickerProps<DateValue> & {
  size?: "sm" | "md" | "lg";
  /** Days to flag with a dot in the calendar, e.g. days that have work due. */
  isDateMarked?: (date: CalendarDate) => boolean;
}) => {
  const state = useDateRangePickerState({
    ...props,
    shouldCloseOnSelect: false
  });
  const ref = useRef<HTMLDivElement>(null);
  const {
    groupProps,
    startFieldProps,
    endFieldProps,
    buttonProps,
    dialogProps,
    calendarProps
  } = useDateRangePicker(props, state, ref);

  return (
    <Popover open={state.isOpen} onOpenChange={state.setOpen}>
      <div className="relative inline-flex flex-col w-full">
        <HStack className="w-full" spacing={0}>
          <InputGroup
            {...groupProps}
            ref={ref}
            size={size}
            className="w-full inline-flex rounded-r-none"
          >
            <div className={fieldVariants({ size })}>
              <DateField {...startFieldProps} size={size} />
              <span aria-hidden="true" className="px-2">
                –
              </span>
              <DateField {...endFieldProps} size={size} />
              {state.isInvalid && (
                <LuBan
                  className={`text-destructive-foreground absolute right-[12px] ${iconVariants(
                    { size }
                  )}`}
                />
              )}
            </div>
          </InputGroup>

          <PopoverTrigger tabIndex={-1}>
            <FieldButton
              {...buttonProps}
              isPressed={state.isOpen}
              size={size}
            />
          </PopoverTrigger>
        </HStack>
        <PopoverContent align="end" {...dialogProps}>
          <RangeCalendar {...calendarProps} isDateMarked={isDateMarked} />
        </PopoverContent>
      </div>
    </Popover>
  );
};

export default DateRangePicker;
