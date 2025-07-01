import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  InputOTP as InputOTPBase,
  InputOTPGroup,
  InputOTPSlot,
} from "@carbon/react";
import type { ReactNode } from "react";
import { forwardRef, useEffect } from "react";
import type { ValidationBehaviorOptions } from "src/internal/getInputProps";
import { useControlField, useField } from "../hooks";

type FormInputOTPProps = {
  name: string;
  label?: ReactNode;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  helperText?: string;
  maxLength?: number;
  validationBehavior?: ValidationBehaviorOptions;
  onConfigure?: () => void;
};

const InputOTP = forwardRef<HTMLInputElement, FormInputOTPProps>(
  (
    {
      name,
      label,
      isConfigured,
      isOptional,
      isRequired,
      helperText,
      maxLength = 6,
      onConfigure,
      ...rest
    },
    ref
  ) => {
    const { error } = useField(name);
    const [value, setValue] = useControlField<string>(name);

    useEffect(() => {
      if (value?.length === maxLength) {
        const form = document
          .querySelector(`input[name="${name}"]`)
          ?.closest("form");
        if (form) {
          form.submit();
        }
      }
    }, [value, maxLength, name]);

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
        ) : null}

        <InputOTPBase
          name={name}
          maxLength={6}
          value={value}
          onChange={setValue}
          ref={ref}
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTPBase>

        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

InputOTP.displayName = "InputOTP";

export default InputOTP;
