import type { DateValue } from "@internationalized/date";
import { useDatePicker } from "@react-aria/datepicker";
import { useDatePickerState } from "@react-stately/datepicker";
import type { DatePickerProps } from "@react-types/datepicker";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { useRef } from "react";
import { LuBan, LuCalendarClock, LuInfo } from "react-icons/lu";
import { cn } from "..";
import { Button } from "../Button";
import { HStack } from "../HStack";
import { IconButton } from "../IconButton";
import { InputGroup } from "../Input";
import {
  Popover,
  PopoverContent,
  PopoverFooter,
  PopoverTrigger
} from "../Popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../Tooltip";
import { FieldButton } from "./components/Button";
import { Calendar } from "./components/Calendar";
import DateField from "./components/DateField";
import { TimeCombobox } from "./TimeCombobox";

const dateTimePickerFieldVariants = cva("flex w-full px-4", {
  variants: {
    size: {
      sm: "py-1",
      md: "py-2",
      lg: "py-3"
    }
  },
  defaultVariants: {
    size: "md"
  }
});

const DateTimePicker = (
  props: DatePickerProps<DateValue> & {
    className?: string;
    size?: "sm" | "md" | "lg";
    withButton?: boolean;
    inline?: ReactNode;
    helperText?: string;
  }
) => {
  // `granularity` is pinned, `hourCycle` is the caller's choice.
  //
  // react-stately DERIVES granularity from the value, so an EMPTY picker falls
  // back to "day" and its `hasTime` is false — picking a date then commits a
  // bare CalendarDate, silently discarding a time already entered. Pinning
  // "minute" is a bug fix and applies to every caller (see
  // `__tests__/DateTimePickerState.test.tsx`).
  //
  // The clock is NOT a bug fix: a timecard or a maintenance start time is an
  // ordinary local-habit field where an en-US user expects AM/PM. Only callers
  // that need an unambiguous wall clock ask for `hourCycle={24}`.
  const timeOptions = {
    granularity: "minute",
    ...(props.hourCycle ? { hourCycle: props.hourCycle } : {})
  } as const;

  const state = useDatePickerState({
    ...props,
    ...timeOptions,
    shouldCloseOnSelect: false
  });
  const ref = useRef<HTMLDivElement>(null);
  // The same options must reach `useDatePicker`, not just the state: it builds
  // `fieldProps`, so without them the visible field ignores what the state says.
  const { groupProps, fieldProps, buttonProps, dialogProps, calendarProps } =
    useDatePicker({ ...props, ...timeOptions }, state, ref);

  return (
    <Popover open={state.isOpen} onOpenChange={state.setOpen}>
      <div className="relative inline-flex flex-col w-full">
        <HStack className="w-full" spacing={0}>
          {props.inline ? (
            <>
              <div className="flex-grow">{props.inline}</div>
              <HStack spacing={0}>
                {props.helperText && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconButton
                        icon={<LuInfo />}
                        variant="ghost"
                        size="sm"
                        aria-label="Helper information"
                      />
                    </TooltipTrigger>
                    <TooltipContent>{props.helperText}</TooltipContent>
                  </Tooltip>
                )}
                <PopoverTrigger asChild>
                  <IconButton
                    icon={<LuCalendarClock />}
                    variant="secondary"
                    size="sm"
                    aria-label="Open date time picker"
                    isDisabled={props.isDisabled}
                    {...buttonProps}
                  />
                </PopoverTrigger>
              </HStack>
            </>
          ) : (
            <>
              <InputGroup
                {...groupProps}
                ref={ref}
                className={cn("w-full inline-flex", props.className)}
                size={props.size}
              >
                <div
                  className={dateTimePickerFieldVariants({ size: props.size })}
                >
                  <DateField {...fieldProps} size={props.size} />
                  {state.isInvalid && (
                    <LuBan className="!text-destructive-foreground absolute right-[12px] top-[12px]" />
                  )}
                </div>
                {props.withButton !== false && (
                  <div
                    className={cn(
                      "flex-shrink-0 -mr-px",
                      props.size === "sm" ? "mt-[-3px]" : "-mt-px"
                    )}
                  >
                    <PopoverTrigger tabIndex={-1}>
                      <FieldButton
                        {...buttonProps}
                        isPressed={state.isOpen}
                        size={props.size}
                      />
                    </PopoverTrigger>
                  </div>
                )}
              </InputGroup>
            </>
          )}
        </HStack>
        <PopoverContent align="end" {...dialogProps}>
          <Calendar {...calendarProps} />
          <div className="pt-3">
            <TimeCombobox
              value={state.timeValue}
              onChange={state.setTimeValue}
              isDisabled={props.isDisabled}
              hour24={props.hourCycle === 24}
              aria-label="Time"
            />
          </div>
          {props.inline && (
            <PopoverFooter>
              <Button onClick={() => state.setValue(null)} variant="secondary">
                Clear
              </Button>
            </PopoverFooter>
          )}
        </PopoverContent>
      </div>
    </Popover>
  );
};

export default DateTimePicker;
