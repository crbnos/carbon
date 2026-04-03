import {
  FormControl,
  FormErrorMessage,
  FormLabel,
  TimePicker as TimePickerBase
} from "@carbon/react";
import type {
  CalendarDateTime,
  Time,
  ZonedDateTime
} from "@internationalized/date";
import { parseTime } from "@internationalized/date";
import { useState } from "react";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type TimePickerProps = {
  name: string;
  label?: string;
  isRequired?: boolean;
  minValue?: TimeValue;
  maxValue?: TimeValue;
  onChange?: (time: TimeValue) => void;
};
type TimeValue = Time | CalendarDateTime | ZonedDateTime;

const TimePicker = ({
  name,
  label,
  isRequired = false,
  onChange
}: TimePickerProps) => {
  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled || formState.isReadOnly;
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
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <input type="hidden" name={name} value={time?.toString()} />
      <TimePickerBase
        value={time ?? undefined}
        //@ts-ignore
        onChange={handleChange}
        isDisabled={isDisabled}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default TimePicker;
