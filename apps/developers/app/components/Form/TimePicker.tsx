import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  TimePicker as TimePickerBase,
} from "@carbon/react";
import { useField } from "@carbon/remix-validated-form";
import type {
  CalendarDateTime,
  Time,
  ZonedDateTime,
} from "@internationalized/date";
import { parseTime } from "@internationalized/date";
import { useState } from "react";

type TimePickerProps = {
  name: string;
  label?: string;
  minValue?: TimeValue;
  maxValue?: TimeValue;
  onChange?: (date: TimeValue) => void;
};
type TimeValue = Time | CalendarDateTime | ZonedDateTime;

const TimePicker = ({ name, label, onChange }: TimePickerProps) => {
  const { error, defaultValue, validate } = useField(name);
  const [date, setDate] = useState<TimeValue | null>(
    defaultValue ? parseTime(defaultValue) : null
  );

  const handleChange = (date: TimeValue) => {
    setDate(date);
    validate();
    onChange?.(date);
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <input type="hidden" name={name} value={date?.toString()} />
      <TimePickerBase
        value={date ?? undefined}
        //@ts-ignore
        onChange={handleChange}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default TimePicker;
