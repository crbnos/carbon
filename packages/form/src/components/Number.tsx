import type { NumberFieldProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper
} from "@carbon/react";

import { forwardRef } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

type FormNumberProps = NumberFieldProps & {
  name: string;
  size?: "sm" | "md" | "lg";
  label?: string;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  helperText?: string;
  onConfigure?: () => void;
};

const Number = forwardRef<HTMLInputElement, FormNumberProps>(
  (
    {
      name,
      size = "md",
      label,
      isConfigured = false,
      isOptional,
      isRequired,
      isReadOnly: isReadOnlyProp,
      isDisabled: isDisabledProp,
      helperText,
      onConfigure,
      ...rest
    },
    ref
  ) => {
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const formState = useFormStateContext();
    const isReadOnly = formState.isReadOnly || isReadOnlyProp;
    const isDisabled = formState.isDisabled || isDisabledProp;
    const formatOptions =
      rest.formatOptions ??
      ({
        minimumFractionDigits: 0,
        maximumFractionDigits: 10
      } satisfies Intl.NumberFormatOptions);
    const resolvedIsOptional =
      isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

    return (
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
            {label}
          </FormLabel>
        )}
        <NumberField
          {...getInputProps({
            id: name,
            ...rest
          })}
          formatOptions={formatOptions}
          isDisabled={isDisabled}
        >
          <NumberInputGroup className="relative">
            <NumberInput
              isReadOnly={isReadOnly}
              isDisabled={isDisabled}
              ref={ref}
              size={size}
            />
            {!isReadOnly && !isDisabled && size !== "sm" && (
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
