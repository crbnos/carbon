import { useFormContext } from "@carbon/form";
import {
  DatePicker as DatePickerBase,
  FormControl,
  FormErrorMessage,
  FormLabel,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useField } from "../hooks";

type DatePickerProps = {
  name: string;
  label?: string;
  isDisabled?: boolean;
  minValue?: CalendarDate;
  maxValue?: CalendarDate;
  inline?: boolean;
  helperText?: string;
  value?: string;
  onChange?: (date: string | null) => void;
};

const DatePicker = ({
  name,
  label,
  isDisabled = false,
  minValue,
  maxValue,
  inline = false,
  helperText,
  value,
  onChange,
}: DatePickerProps) => {
  const { validate } = useFormContext();
  const { error, defaultValue, validate: validateField } = useField(name);
  const [date, setDate] = useState<CalendarDate | undefined>(
    value
      ? parseDate(value)
      : defaultValue
      ? parseDate(defaultValue)
      : undefined
  );

  useEffect(() => {
    if (value) {
      setDate(parseDate(value));
    }
  }, [value]);

  const handleChange = async (newDate: CalendarDate) => {
    const formattedDate = newDate ? newDate.toString() : null;
    flushSync(() => {
      setDate(newDate);
    });
    if (inline) {
      const result = await validate();
      if (result.error) {
        setDate(date);
      } else {
        onChange?.(formattedDate);
      }
    } else {
      validateField();
      onChange?.(formattedDate);
    }
  };

  const utcValue = date ? date.toString() : "";

  const DatePickerPreview = (
    <span className="flex-grow line-clamp-1">{formatDate(utcValue)}</span>
  );

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
        inline={inline ? DatePickerPreview : undefined}
        helperText={helperText}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default DatePicker;
