// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CalendarDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useDateRangePicker } from "@react-aria/datepicker";
import { useDateRangePickerState } from "@react-stately/datepicker";
import type { DateRangePickerProps, DateValue } from "@react-types/datepicker";
import { cva } from "class-variance-authority";
import { useRef } from "react";
import { LuBan } from "react-icons/lu";
import { HStack } from "../HStack";
import { InputGroup } from "../Input";
import { Popover, PopoverAnchor, PopoverContent } from "../Popover";
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
  /** The field's name for assistive tech; defaults to `label`. */
  "aria-label"?: string;
}) => {
  const { t } = useLingui();
  const state = useDateRangePickerState({
    ...props,
    shouldCloseOnSelect: false
  });
  const ref = useRef<HTMLDivElement>(null);
  // Opened from an anchor, not a Radix trigger, so Radix has no trigger to
  // return focus to on close: this holds the calendar button.
  const anchorRef = useRef<HTMLDivElement>(null);
  // Set when the popover closes from a click or focus outside it: focus then
  // stays where the user put it, as Radix does for a trigger. A click on
  // nothing focusable (a sheet's overlay) still returns it to the button.
  const closedFromOutside = useRef(false);
  const {
    groupProps,
    startFieldProps,
    endFieldProps,
    buttonProps,
    dialogProps,
    calendarProps
  } = useDateRangePicker(
    // Nothing here draws `label`, so name the group with it directly (as
    // DatePicker does); without one it is still a "Date range".
    {
      ...props,
      label: undefined,
      "aria-label":
        props["aria-label"] ??
        (typeof props.label === "string" ? props.label : t`Date range`)
    },
    state,
    ref
  );

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

          {/* Anchor (not Trigger) so the calendar button isn't wrapped in a
              second <button>; react-aria's buttonProps open the popover. */}
          <PopoverAnchor asChild>
            <div ref={anchorRef} className="flex-shrink-0">
              <FieldButton
                {...buttonProps}
                isPressed={state.isOpen}
                size={size}
              />
            </div>
          </PopoverAnchor>
        </HStack>
        <PopoverContent
          align="end"
          {...dialogProps}
          onInteractOutside={() => {
            closedFromOutside.current = true;
          }}
          onCloseAutoFocus={(event) => {
            const fromOutside = closedFromOutside.current;
            closedFromOutside.current = false;
            const focused = document.activeElement;
            if (fromOutside && focused && focused !== document.body) return;
            const button = anchorRef.current?.querySelector("button");
            if (!button) return;
            event.preventDefault();
            button.focus();
          }}
        >
          <RangeCalendar {...calendarProps} isDateMarked={isDateMarked} />
        </PopoverContent>
      </div>
    </Popover>
  );
};

export default DateRangePicker;
