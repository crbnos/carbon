import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  TimePicker as TimePickerBase,
} from "@carbon/react";
import type {
  CalendarDateTime,
  Time,
  ZonedDateTime,
} from "@internationalized/date";
import { parseTime } from "@internationalized/date";
import { useState } from "react";
import { useField } from "../hooks";

type TimePickerProps = {
  name: string;
  label?: string;
  minValue?: TimeValue;
  maxValue?: TimeValue;
  onChange?: (time: TimeValue) => void;
};
type TimeValue = Time | CalendarDateTime | ZonedDateTime;

const TimePicker = ({ name, label, onChange }: TimePickerProps) => {
  const { error, defaultValue, validate } = useField(name);
  const [time, setDate] = useState<TimeValue | null>(
    defaultValue ? parseTime(defaultValue) : null
  );

  const handleChange = (time: TimeValue) => {
    setDate(time);
    validate();
    onChange?.(time);
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <input type="hidden" name={name} value={time?.toString()} />
      <TimePickerBase
        value={time ?? undefined}
        //@ts-ignore
        onChange={handleChange}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default TimePicker;
