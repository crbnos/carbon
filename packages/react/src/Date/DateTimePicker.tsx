import type { DateValue } from "@internationalized/date";
import { useDatePicker } from "@react-aria/datepicker";
import { useDatePickerState } from "@react-stately/datepicker";
import type { DatePickerProps } from "@react-types/datepicker";
import { useRef } from "react";
import { MdOutlineDoNotDisturb } from "react-icons/md";
import { HStack } from "../HStack";
import { InputGroup } from "../Input";
import { useOutsideClick } from "../hooks";
import TimeField from "./TimePicker";
import { FieldButton } from "./components/Button";
import { Calendar } from "./components/Calendar";
import DateField from "./components/DateField";
import { Popover } from "./components/Popover";

const DateTimePicker = (props: DatePickerProps<DateValue>) => {
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
    <div className="relative inline-flex flex-col w-full">
      <HStack className="w-full" spacing={0}>
        <InputGroup
          {...groupProps}
          ref={ref}
          className="w-full inline-flex rounded-r-none"
        >
          <div className="flex w-full px-4 py-2">
            <DateField {...fieldProps} />
            {state.isInvalid && (
              <MdOutlineDoNotDisturb className="text-destructive-foreground absolute right-[12px]" />
            )}
          </div>
        </InputGroup>

        <FieldButton {...buttonProps} isPressed={state.isOpen} />
      </HStack>
      {state.isOpen && (
        <Popover {...dialogProps} onClose={() => state.setOpen(false)}>
          <Calendar {...calendarProps} />
          <TimeField
            label="Time"
            value={state.timeValue}
            onChange={state.setTimeValue}
          />
        </Popover>
      )}
    </div>
  );
};

export default DateTimePicker;
