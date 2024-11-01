import {
  DateTimePicker as DateTimePickerBase,
  FormControl,
  FormErrorMessage,
  FormLabel,
} from "@carbon/react";
import type { CalendarDateTime } from "@internationalized/date";
import {
  getLocalTimeZone,
  parseAbsolute,
  toCalendarDateTime,
  toZoned,
} from "@internationalized/date";
import { useState } from "react";
import { useField } from "../hooks";

type DateTimePickerProps = {
  name: string;
  label?: string;
  isDisabled?: boolean;
  minValue?: CalendarDateTime;
  maxValue?: CalendarDateTime;
  onChange?: (date: CalendarDateTime) => void;
};

const DateTimePicker = ({
  name,
  label,
  isDisabled = false,
  minValue,
  maxValue,
  onChange,
}: DateTimePickerProps) => {
  const { error, defaultValue, validate } = useField(name);
  const [date, setDate] = useState<CalendarDateTime | undefined>(
    defaultValue
      ? toCalendarDateTime(parseAbsolute(defaultValue, getLocalTimeZone()))
      : undefined
  );

  const handleChange = (date: CalendarDateTime) => {
    setDate(toCalendarDateTime(date));
    onChange?.(toCalendarDateTime(date));
    validate();
  };

  // Convert local time to UTC for storage
  const utcValue = date
    ? toZoned(date, getLocalTimeZone()).toAbsoluteString()
    : "";

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <input type="hidden" name={name} value={utcValue} />
      <DateTimePickerBase
        value={date}
        onChange={handleChange}
        isDisabled={isDisabled}
        minValue={minValue}
        maxValue={maxValue}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default DateTimePicker;
