import { useFormContext } from "@carbon/form";
import {
  DatePicker as DatePickerBase,
  FormControl,
  FormErrorMessage,
  FormLabel
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { parseDate } from "@internationalized/date";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type DatePickerProps = {
  name: string;
  label?: string;
  isDisabled?: boolean;
  isRequired?: boolean;
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
  isDisabled: isDisabledProp = false,
  isRequired,
  minValue,
  maxValue,
  inline = false,
  helperText,
  value,
  onChange
}: DatePickerProps) => {
  const { locale } = useLocale();
  const formState = useFormStateContext();
  const isDisabled =
    formState.isDisabled || formState.isReadOnly || isDisabledProp;
  const { validate } = useFormContext();
  const {
    error,
    defaultValue,
    validate: validateField,
    isOptional: fieldIsOptional
  } = useField(name);
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

  const handleChange = async (newDate: CalendarDate | null) => {
    if (!newDate) return;
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
    <span className="flex flex-grow line-clamp-1 items-center">
      {formatDate(utcValue, undefined, locale)}
    </span>
  );

  return (
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && (
        <FormLabel
          htmlFor={name}
          isOptional={isRequired ? false : (fieldIsOptional ?? false)}
        >
          {label}
        </FormLabel>
      )}
      <input type="hidden" name={name} value={utcValue} />
      <DatePickerBase
        value={date}
        isDisabled={isDisabled}
        minValue={minValue}
        maxValue={maxValue}
        onChange={handleChange as any}
        inline={inline ? DatePickerPreview : undefined}
        helperText={helperText}
        label={label}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default DatePicker;
