// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import { useFormContext } from "@carbon/form";
import {
  DateTimePicker as DateTimePickerBase,
  FormControl,
  FormErrorMessage,
  FormLabel,
  LabelWithHelp
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import type { CalendarDateTime } from "@internationalized/date";
import {
  getLocalTimeZone,
  parseAbsolute,
  toCalendarDateTime,
  toZoned
} from "@internationalized/date";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import { useInlineField } from "../internal/inlineField";

type DateTimePickerProps = {
  name: string;
  label?: string;
  termId?: TermId;
  size?: "sm" | "md" | "lg";
  isDisabled?: boolean;
  minValue?: CalendarDateTime;
  maxValue?: CalendarDateTime;
  inline?: boolean;
  helperText?: string;
  /**
   * The IANA zone the wall-clock value is read and written in. Defaults to
   * the browser's zone. Pass the company's zone for a time that belongs to the
   * company's calendar (a visit window), so a dispatcher in another zone
   * stores the same instant.
   */
  timeZone?: string;
  onChange?: (date: CalendarDateTime) => void;
};

const DateTimePicker = ({
  name,
  label,
  termId,
  size,
  isDisabled: isDisabledProp = false,
  minValue,
  maxValue,
  inline = false,
  helperText,
  timeZone: timeZoneProp,
  onChange
}: DateTimePickerProps) => {
  const timeZone = timeZoneProp ?? getLocalTimeZone();
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
  const [date, setDate] = useState<CalendarDateTime | undefined>(
    defaultValue
      ? toCalendarDateTime(parseAbsolute(defaultValue, timeZone))
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

  // Convert the wall-clock time in `timeZone` to a UTC instant for storage
  const utcValue = date ? toZoned(date, timeZone).toAbsoluteString() : "";
  const inlineField = useInlineField({
    inline,
    label,
    isEmpty: !date,
    isReadOnly: isDisabled
  });

  const DateTimePickerPreview = (
    <span className="flex flex-grow line-clamp-1 items-center">
      {formatDateTime(utcValue, locale)}
    </span>
  );

  return (
    <FormControl isInvalid={!!error}>
      {label && inlineField.showLabel && (
        <FormLabel htmlFor={name} isOptional={fieldIsOptional ?? false}>
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </FormLabel>
      )}
      <input type="hidden" name={name} value={utcValue} />
      <DateTimePickerBase
        value={date}
        onChange={handleChange as any}
        isDisabled={isDisabled}
        size={size}
        minValue={minValue}
        maxValue={maxValue}
        inline={inline ? DateTimePickerPreview : undefined}
        inlinePlaceholder={inlineField.placeholder}
        helperText={helperText}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
};

export default DateTimePicker;
