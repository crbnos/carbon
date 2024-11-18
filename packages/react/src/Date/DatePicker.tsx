import type { CalendarDate } from "@internationalized/date";
import { useDatePicker } from "@react-aria/datepicker";
import { useDatePickerState } from "@react-stately/datepicker";
import type { DatePickerProps } from "@react-types/datepicker";
import type { ReactNode } from "react";
import { useRef } from "react";
import { LuBan, LuCalendarClock } from "react-icons/lu";
import { Button } from "../Button";
import { HStack } from "../HStack";
import { IconButton } from "../IconButton";
import { InputGroup } from "../Input";
import {
  Popover,
  PopoverContent,
  PopoverFooter,
  PopoverTrigger,
} from "../Popover";
import { useOutsideClick } from "../hooks";
import { FieldButton } from "./components/Button";
import { Calendar } from "./components/Calendar";
import DateField from "./components/DateField";

const DatePicker = (
  props: DatePickerProps<CalendarDate> & { inline?: ReactNode }
) => {
  const state = useDatePickerState({
    ...props,
    shouldCloseOnSelect: false,
  });
  const ref = useRef<HTMLDivElement>(null);
  const { groupProps, fieldProps, buttonProps, dialogProps, calendarProps } =
    useDatePicker(props, state, ref);

  useOutsideClick({
    ref,
    handler: () => state.setOpen(false),
  });

  return (
    <Popover open={state.isOpen} onOpenChange={state.setOpen}>
      <div className="relative inline-flex flex-col w-full">
        <HStack className="w-full" spacing={0}>
          {props.inline ? (
            <>
              <div className="flex-grow">{props.inline}</div>
              <PopoverTrigger asChild>
                <IconButton
                  icon={<LuCalendarClock />}
                  variant="secondary"
                  size="sm"
                  aria-label="Open date picker"
                  {...buttonProps}
                />
              </PopoverTrigger>
            </>
          ) : (
            <>
              <InputGroup
                {...groupProps}
                ref={ref}
                className="w-full inline-flex rounded-r-none"
              >
                <div className="flex w-full px-4 py-2">
                  <DateField {...fieldProps} />
                  {state.isInvalid && (
                    <LuBan className="!text-destructive-foreground absolute right-[12px] top-[12px]" />
                  )}
                </div>
              </InputGroup>
              <PopoverTrigger>
                <FieldButton {...buttonProps} isPressed={state.isOpen} />
              </PopoverTrigger>
            </>
          )}
        </HStack>
        <PopoverContent align="end" {...dialogProps}>
          <Calendar {...calendarProps} />
          <PopoverFooter>
            <Button onClick={() => state.setValue(null)} variant="secondary">
              Clear
            </Button>
          </PopoverFooter>
        </PopoverContent>
      </div>
    </Popover>
  );
};

export default DatePicker;
