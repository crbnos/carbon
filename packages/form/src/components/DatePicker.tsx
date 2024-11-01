import {
  DatePicker as DatePickerBase,
  FormControl,
  FormErrorMessage,
  FormLabel,
} from "@carbon/react";
import type { CalendarDate } from "@internationalized/date";
import { getLocalTimeZone, parseDate, toZoned } from "@internationalized/date";
import { useState } from "react";
import { useField } from "../hooks";

type DatePickerProps = {
  name: string;
  label?: string;
  onChange?: (date: CalendarDate) => void;
  isDisabled?: boolean;
  minValue?: CalendarDate;
  maxValue?: CalendarDate;
};

const DatePicker = ({
  name,
  label,
  isDisabled = false,
  minValue,
  maxValue,
  onChange,
}: DatePickerProps) => {
  const { error, defaultValue, validate } = useField(name);
  const [date, setDate] = useState<CalendarDate | undefined>(
    defaultValue ? parseDate(defaultValue) : undefined
  );

  const handleChange = (date: CalendarDate) => {
    setDate(date);
    onChange?.(date);
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
      <DatePickerBase
        value={date}
        isDisabled={isDisabled}
        minValue={minValue}
        maxValue={maxValue}
        onChange={handleChange}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default DatePicker;
