import { useFormContext } from "@carbon/form";
import {
  DateTimePicker as DateTimePickerBase,
  FormControl,
  FormErrorMessage,
  FormLabel
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import type { CalendarDateTime } from "@internationalized/date";
import {
  getLocalTimeZone,
  parseAbsolute,
  toCalendarDateTime,
  toZoned
} from "@internationalized/date";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type DateTimePickerProps = {
  name: string;
  label?: string;
  isDisabled?: boolean;
  isRequired?: boolean;
  minValue?: CalendarDateTime;
  maxValue?: CalendarDateTime;
  inline?: boolean;
  helperText?: string;
  onChange?: (date: CalendarDateTime) => void;
};

const DateTimePicker = ({
  name,
  label,
  isDisabled: isDisabledProp = false,
  isRequired = false,
  minValue,
  maxValue,
  inline = false,
  helperText,
  onChange
}: DateTimePickerProps) => {
  const formState = useFormStateContext();
  const isDisabled =
    formState.isDisabled || formState.isReadOnly || isDisabledProp;
  const { validate } = useFormContext();
  const { error, defaultValue, validate: validateField } = useField(name);
  const [date, setDate] = useState<CalendarDateTime | undefined>(
    defaultValue
      ? toCalendarDateTime(parseAbsolute(defaultValue, getLocalTimeZone()))
      : undefined
  );

  const handleChange = async (newDate: CalendarDateTime) => {
    flushSync(() => {
      setDate(toCalendarDateTime(newDate));
    });
    if (inline) {
      const result = await validate();
      if (result.error) {
        setDate(date);
      } else {
        onChange?.(toCalendarDateTime(newDate));
      }
    } else {
      validateField();
      onChange?.(toCalendarDateTime(newDate));
    }
  };

  // Convert local time to UTC for storage
  const utcValue = date
    ? toZoned(date, getLocalTimeZone()).toAbsoluteString()
    : "";

  const DateTimePickerPreview = (
    <span className="flex flex-grow line-clamp-1 items-center">
      {formatDateTime(utcValue)}
    </span>
  );

  return (
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      <input type="hidden" name={name} value={utcValue} />
      <DateTimePickerBase
        value={date}
        onChange={handleChange as any}
        isDisabled={isDisabled}
        minValue={minValue}
        maxValue={maxValue}
        inline={inline ? DateTimePickerPreview : undefined}
        helperText={helperText}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default DateTimePicker;
