import type { NumberFieldProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  VStack,
} from "@carbon/react";

import { useFormContext } from "@carbon/form";
import type { ReactNode } from "react";
import { forwardRef, useEffect, useRef, useState } from "react";
import {
  LuChevronDown,
  LuChevronUp,
  LuPlus,
  LuSettings2,
} from "react-icons/lu";
import { useControlField, useField } from "../hooks";

type FormNumberProps = NumberFieldProps & {
  name: string;
  label?: ReactNode;
  isRequired?: boolean;
  helperText?: string;
  value: number;
  inline?: boolean;
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
      inline = false,
      onBlur,
      ...rest
    },
    ref
  ) => {
    const { validate } = useFormContext();
    const { getInputProps, error } = useField(name);
    const [controlValue, setControlValue] = useControlField<number>(name);
    const [inlineMode, setInlineMode] = useState(inline);
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

    return inlineMode ? (
      <VStack>
        {label && (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <HStack spacing={0} className="w-full justify-between">
          {value !== undefined && (
            <span className="flex-grow line-clamp-1">{value}</span>
          )}
          <IconButton
            icon={value !== undefined ? <LuSettings2 /> : <LuPlus />}
            aria-label={value !== undefined ? "Edit" : "Add"}
            size="sm"
            variant="secondary"
            isDisabled={isReadOnly}
            onClick={() => setInlineMode(false)}
          />
        </HStack>
      </VStack>
    ) : (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <NumberField
          {...getInputProps({
            id: name,
            ...rest,
          })}
          value={controlValue}
          onChange={handleChange}
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
