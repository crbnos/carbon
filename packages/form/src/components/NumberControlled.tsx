// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import { useFormContext } from "@carbon/form";
import type { NumberFieldProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  InlineTrigger,
  LabelWithHelp,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  VStack
} from "@carbon/react";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import { useInlineField } from "../internal/inlineField";

type FormNumberProps = NumberFieldProps & {
  name: string;
  label?: ReactNode;
  termId?: TermId;
  size?: "sm" | "md" | "lg";
  isOptional?: boolean;
  isRequired?: boolean;
  helperText?: string;
  value: number;
  inline?: boolean;
  isConfigured?: boolean;
  onChange?: (newValue: number) => void;
  onConfigure?: () => void;
};

const Number = forwardRef<HTMLInputElement, FormNumberProps>(
  (
    {
      name,
      label,
      termId,
      size,
      isConfigured,
      isOptional,
      isRequired,
      isReadOnly: isReadOnlyProp,
      isDisabled: isDisabledProp,
      helperText,
      value,
      onChange,
      onConfigure,
      inline = false,
      onBlur,
      ...rest
    },
    ref
  ) => {
    const formState = useFormStateContext();
    const isReadOnly = formState.isReadOnly || isReadOnlyProp;
    const isDisabled = formState.isDisabled || isDisabledProp;
    const { validate } = useFormContext();
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const [controlValue, setControlValue] = useControlField<number>(name);
    const [inlineMode, setInlineMode] = useState(inline);
    // The inline preview reads the value with the digits it is edited with
    // ($10,000.00, 8.25%) — a raw number would show 10000 or 0.0825.
    const formatter = useNumberFormatter(rest.formatOptions ?? {});
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      setControlValue(value);
    }, [setControlValue, value]);

    useEffect(() => {
      if (inline && !inlineMode) {
        inputRef.current?.focus();
      }
    }, [inline, inlineMode]);

    const handleChange = (newValue: number) => {
      setControlValue(newValue);
      onChange?.(newValue);
    };
    const resolvedIsOptional =
      isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));
    const hasValue = value !== undefined && !isNaN(value);
    const inlineField = useInlineField({
      inline,
      label,
      isEmpty: !hasValue,
      isReadOnly: isReadOnly || isDisabled
    });

    return inlineMode ? (
      <VStack>
        {label && inlineField.showLabel && (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <div className="flex w-full">
          <InlineTrigger
            isEmpty={!hasValue}
            placeholder={inlineField.placeholder}
            isDisabled={isReadOnly || isDisabled}
            onClick={() => setInlineMode(false)}
          >
            {hasValue && rest.formatOptions ? formatter.format(value) : value}
          </InlineTrigger>
        </div>
      </VStack>
    ) : (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        isDisabled={isDisabled}
        isReadOnly={isReadOnly}
      >
        {label && (
          <FormLabel
            htmlFor={name}
            isOptional={resolvedIsOptional}
            isConfigured={isConfigured}
            onConfigure={onConfigure}
          >
            <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
          </FormLabel>
        )}
        <NumberField
          {...getInputProps({
            id: name,
            ...rest
          })}
          value={controlValue}
          onChange={handleChange}
          isDisabled={isDisabled}
          isReadOnly={isReadOnly}
          onBlur={async (e) => {
            if (inline) {
              const result = await validate();
              if (!result.error) {
                onBlur?.(e);
                setInlineMode(true);
              }
            } else {
              onBlur?.(e);
            }
          }}
        >
          <NumberInputGroup className="relative">
            <NumberInput
              isReadOnly={isReadOnly}
              isDisabled={isDisabled}
              size={size}
            />
            {!isReadOnly && (
              <NumberInputStepper>
                <NumberIncrementStepper>
                  <LuChevronUp size="1em" strokeWidth="3" />
                </NumberIncrementStepper>
                <NumberDecrementStepper>
                  <LuChevronDown size="1em" strokeWidth="3" />
                </NumberDecrementStepper>
              </NumberInputStepper>
            )}
          </NumberInputGroup>
        </NumberField>
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Number.displayName = "Number";

export default Number;
