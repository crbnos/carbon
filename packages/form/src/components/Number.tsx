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
  NumberInputStepper,
} from "@carbon/react";

import { forwardRef } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { useField } from "../hooks";

type FormNumberProps = NumberFieldProps & {
  name: string;
  label?: string;
  isConfigured?: boolean;
  isRequired?: boolean;
  helperText?: string;
  onConfigure?: () => void;
};

const Number = forwardRef<HTMLInputElement, FormNumberProps>(
  (
    {
      name,
      label,
      isConfigured = false,
      isRequired,
      isReadOnly,
      helperText,
      onConfigure,
      ...rest
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && (
          <FormLabel
            htmlFor={name}
            isConfigured={isConfigured}
            onConfigure={onConfigure}
          >
            {label}
          </FormLabel>
        )}
        <NumberField
          {...getInputProps({
            id: name,
            ...rest,
          })}
        >
          <NumberInputGroup className="relative">
            <NumberInput isReadOnly={isReadOnly} />
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
