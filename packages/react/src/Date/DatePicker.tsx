import type { CalendarDate } from "@internationalized/date";
import { useDatePicker } from "@react-aria/datepicker";
import { useDatePickerState } from "@react-stately/datepicker";
import type { DatePickerProps } from "@react-types/datepicker";
import type { ReactNode } from "react";
import { useRef } from "react";
import { LuBan, LuCalendarClock, LuInfo } from "react-icons/lu";
import { Button } from "../Button";
import { HStack } from "../HStack";
import { IconButton } from "../IconButton";
import { InputGroup } from "../Input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverFooter,
  PopoverTrigger
} from "../Popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../Tooltip";
import { FieldButton } from "./components/Button";
import { Calendar } from "./components/Calendar";
import DateField from "./components/DateField";

const DatePicker = (
  props: DatePickerProps<CalendarDate> & {
    inline?: ReactNode;
    isPreviewInline?: boolean;
    helperText?: string;
    closeOnSelect?: boolean;
  }
) => {
  const state = useDatePickerState({
    ...props,
    shouldCloseOnSelect: props.closeOnSelect ?? false
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
              {props.isPreviewInline && typeof props.inline !== "boolean" ? (
                <PopoverTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    aria-label="Open date picker"
                    isDisabled={props.isDisabled}
                    {...buttonProps}
                  >
                    {props.inline}
                    <LuCalendarClock />
                  </Button>
                </PopoverTrigger>
              ) : (
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
                        aria-label="Open date picker"
                        isDisabled={props.isDisabled}
                        {...buttonProps}
                      />
                    </PopoverTrigger>
                  </HStack>
                </>
              )}
            </>
          ) : (
            <>
              <InputGroup
                {...groupProps}
                ref={ref}
                className="w-full inline-flex"
                isDisabled={props.isDisabled || props.isReadOnly}
              >
                <div className="flex w-full px-4 py-2">
                  <DateField {...fieldProps} />
                  {state.isInvalid && (
                    <LuBan className="!text-destructive-foreground absolute right-[12px] top-[12px]" />
                  )}
                </div>
                {/* Anchor (not Trigger) so the calendar button isn't wrapped
                    in a second <button>; the popover open state is driven by
                    react-aria's buttonProps on FieldButton. */}
                <PopoverAnchor asChild>
                  <div className="flex-shrink-0 -mt-px">
                    <FieldButton {...buttonProps} isPressed={state.isOpen} />
                  </div>
                </PopoverAnchor>
              </InputGroup>
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
