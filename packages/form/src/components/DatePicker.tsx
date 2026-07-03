import { useFormContext } from "@carbon/form";
import type { TermId } from "@carbon/glossary";
import {
  DatePicker as DatePickerBase,
  FormControl,
  FormErrorMessage,
  FormLabel,
  LabelWithHelp
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
  termId?: TermId;
  isDisabled?: boolean;
  isRequired?: boolean;
  minValue?: CalendarDate;
  maxValue?: CalendarDate;
  inline?: boolean;
  helperText?: string;
  value?: string;
  onChange?: (date: string | null) => void;
};

const safeParseDate = (value: string | undefined): CalendarDate | undefined => {
  if (!value) return undefined;
  try {
    const cleaned = value.trim();
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return parseDate(cleaned);
    }
    // YYYY-MM-DDTHH:mm:...
    if (/^\d{4}-\d{2}-\d{2}T/.test(cleaned)) {
      return parseDate(cleaned.slice(0, 10));
    }
    const parsed = Date.parse(cleaned);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return parseDate(iso);
    }
  } catch (e) {
    console.error("DatePicker: Failed to parse date string:", value, e);
  }
  return undefined;
};

const DatePicker = ({
  name,
  label,
  termId,
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
    safeParseDate(value) ?? safeParseDate(defaultValue)
  );

  useEffect(() => {
    if (value) {
      setDate(safeParseDate(value));
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
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
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
