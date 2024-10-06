import type { CalendarDate } from "@internationalized/date";
import { useDatePicker } from "@react-aria/datepicker";
import { useDatePickerState } from "@react-stately/datepicker";
import type { DatePickerProps } from "@react-types/datepicker";
import { useRef } from "react";
import { LuBan } from "react-icons/lu";
import { HStack } from "../HStack";
import { InputGroup } from "../Input";
import { useOutsideClick } from "../hooks";
import { FieldButton } from "./components/Button";
import { Calendar } from "./components/Calendar";
import DateField from "./components/DateField";
import { Popover } from "./components/Popover";
const DatePicker = (props: DatePickerProps<CalendarDate>) => {
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
              <LuBan className="!text-destructive-foreground absolute right-[12px] top-[12px]" />
            )}
          </div>
        </InputGroup>

        <FieldButton {...buttonProps} isPressed={state.isOpen} />
      </HStack>
      {state.isOpen && (
        <Popover {...dialogProps} onClose={() => state.setOpen(false)}>
          <Calendar {...calendarProps} />
        </Popover>
      )}
    </div>
  );
};

export default DatePicker;
