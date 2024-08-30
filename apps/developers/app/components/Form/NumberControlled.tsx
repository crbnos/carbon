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

import { useControlField, useField } from "@carbon/remix-validated-form";
import { forwardRef, useEffect } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";

type FormNumberProps = NumberFieldProps & {
  name: string;
  label?: string;
  isRequired?: boolean;
  helperText?: string;
  value: number;
  onChange?: (newValue: number) => void;
};

const Number = forwardRef<HTMLInputElement, FormNumberProps>(
  (
    {
      name,
      label,
      isRequired,
      isReadOnly,
      helperText,
      value,
      onChange,
      ...rest
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);
    const [controlValue, setControlValue] = useControlField<number>(name);

    useEffect(() => {
      setControlValue(value);
    }, [setControlValue, value]);

    const handleChange = (newValue: number) => {
      setControlValue(newValue);
      onChange?.(newValue);
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <NumberField
          {...getInputProps({
            id: name,
            ...rest,
          })}
          value={controlValue}
          onChange={handleChange}
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
