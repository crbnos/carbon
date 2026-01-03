import type { DateValue } from "@internationalized/date";
import { useDatePicker } from "@react-aria/datepicker";
import { useDatePickerState } from "@react-stately/datepicker";
import type { DatePickerProps } from "@react-types/datepicker";
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
import TimeField from "./TimePicker";

const DateTimePicker = (
  props: DatePickerProps<DateValue> & {
    className?: string;
    withButton?: boolean;
    inline?: ReactNode;
    helperText?: string;
  }
) => {
  const state = useDatePickerState({
    ...props,
    shouldCloseOnSelect: false
  });
  const ref = useRef<HTMLDivElement>(null);
  const { groupProps, fieldProps, buttonProps, dialogProps, calendarProps } =
    useDatePicker(props, state, ref);

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
              >
                <div className="flex w-full px-4 py-2">
                  <DateField {...fieldProps} />
                  {state.isInvalid && (
                    <LuBan className="!text-destructive-foreground absolute right-[12px] top-[12px]" />
                  )}
                </div>
                {props.withButton !== false && (
                  <div className="flex-shrink-0 -mt-px">
                    <PopoverTrigger tabIndex={-1}>
                      <FieldButton {...buttonProps} isPressed={state.isOpen} />
                    </PopoverTrigger>
                  </div>
                )}
              </InputGroup>
            </>
          )}
        </HStack>
        <PopoverContent align="end" {...dialogProps}>
          <Calendar {...calendarProps} />
          <TimeField
            label="Time"
            value={state.timeValue}
            onChange={state.setTimeValue}
          />
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
