import { useDateRangePicker } from "@react-aria/datepicker";
import { useDateRangePickerState } from "@react-stately/datepicker";
import type { DateRangePickerProps, DateValue } from "@react-types/datepicker";
import { cva } from "class-variance-authority";
import { useRef } from "react";
import { LuBan } from "react-icons/lu";
import { HStack } from "../HStack";
import { InputGroup } from "../Input";
import { FieldButton } from "./components/Button";
import DateField from "./components/DateField";
import { Popover } from "./components/Popover";
import { RangeCalendar } from "./components/RangeCalendar";

const iconVariants = cva("", {
  variants: {
    size: {
      sm: "h-3 w-3",
      md: "h-4 w-4",
      lg: "h-5 w-5",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const fieldVariants = cva("flex w-full", {
  variants: {
    size: {
      sm: "px-2 py-1",
      md: "px-4 py-2",
      lg: "px-6 py-3",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const DateRangePicker = ({
  size = "md",
  ...props
}: DateRangePickerProps<DateValue> & {
  size?: "sm" | "md" | "lg";
}) => {
  const state = useDateRangePickerState({
    ...props,
    shouldCloseOnSelect: false,
  });
  const ref = useRef<HTMLDivElement>(null);
  const {
    groupProps,
    startFieldProps,
    endFieldProps,
    buttonProps,
    dialogProps,
    calendarProps,
  } = useDateRangePicker(props, state, ref);

  return (
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

        <FieldButton {...buttonProps} isPressed={state.isOpen} size={size} />
      </HStack>
      {state.isOpen && (
        <Popover
          {...dialogProps}
          isOpen={state.isOpen}
          onClose={() => state.setOpen(false)}
        >
          <RangeCalendar {...calendarProps} />
        </Popover>
      )}
    </div>
  );
};

export default DateRangePicker;
