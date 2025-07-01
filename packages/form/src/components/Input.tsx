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
import type { ReactNode } from "react";
import { forwardRef } from "react";
import type { ValidationBehaviorOptions } from "src/internal/getInputProps";
import { useField } from "../hooks";

type FormInputProps = InputProps & {
  name: string;
  label?: ReactNode;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  helperText?: string;
  prefix?: string;
  suffix?: string;
  validationBehavior?: ValidationBehaviorOptions;
  onConfigure?: () => void;
};

const Input = forwardRef<HTMLInputElement, FormInputProps>(
  (
    {
      name,
      label,
      isConfigured,
      isOptional,
      isRequired,
      helperText,
      prefix,
      suffix,
      onConfigure,
      ...rest
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label ? (
          <FormLabel
            htmlFor={name}
            isOptional={isOptional}
            isConfigured={isConfigured}
            onConfigure={onConfigure}
          >
            {label}
          </FormLabel>
        ) : (
          <label htmlFor={name} className="sr-only">
            {rest.placeholder ?? name}
          </label>
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
