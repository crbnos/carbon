import type { InputProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Input as InputBase,
  InputGroup,
  InputLeftAddon,
  InputRightAddon,
} from "@carbon/react";
import { forwardRef } from "react";
import { useField } from "../hooks";

type FormInputProps = InputProps & {
  name: string;
  label?: string;
  isOptional?: boolean;
  helperText?: string;
  prefix?: string;
  suffix?: string;
};

const Input = forwardRef<HTMLInputElement, FormInputProps>(
  (
    { name, label, isOptional = false, helperText, prefix, suffix, ...rest },
    ref
  ) => {
    const { getInputProps, error } = useField(name);

    return (
      <FormControl isInvalid={!!error}>
        {label && (
          <FormLabel htmlFor={name} isOptional={isOptional}>
            {label}
          </FormLabel>
        )}
        {prefix || suffix ? (
          <InputGroup>
            {prefix && <InputLeftAddon children={prefix} />}
            <InputBase
              ref={ref}
              {...getInputProps({
                id: name,
                ...rest,
              })}
            />
            {suffix && <InputRightAddon children={suffix} />}
          </InputGroup>
        ) : (
          <InputBase
            ref={ref}
            {...getInputProps({
              id: name,
              ...rest,
            })}
          />
        )}

        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

Input.displayName = "Input";

export default Input;
