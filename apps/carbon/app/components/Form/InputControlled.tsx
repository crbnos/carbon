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
import { useControlField, useField } from "@carbon/remix-validated-form";
import type { ChangeEvent } from "react";
import { forwardRef, useEffect } from "react";

type FormInputControlledProps = Omit<InputProps, "value" | "onChange"> & {
  name: string;
  label?: string;
  isRequired?: boolean;
  helperText?: string;
  prefix?: string;
  suffix?: string;
  value: string;
  onChange?: (newValue: string) => void;
};

const InputControlled = forwardRef<HTMLInputElement, FormInputControlledProps>(
  (
    {
      name,
      label,
      isRequired,
      helperText,
      prefix,
      suffix,
      value,
      className,
      onChange,
      ...rest
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);
    const [controlValue, setControlValue] = useControlField<string>(name);

    useEffect(() => {
      setControlValue(value);
    }, [setControlValue, value]);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      setControlValue(e.target.value);
      if (onChange && typeof onChange === "function") {
        onChange(e.target.value);
      }
    };

    return (
      <FormControl
        isInvalid={!!error}
        isRequired={isRequired}
        className={className}
      >
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
        <InputGroup>
          {prefix && <InputLeftAddon children={prefix} />}
          <InputBase
            ref={ref}
            {...getInputProps({
              id: name,
              ...rest,
              // @ts-ignore
              value: controlValue,
            })}
            onChange={handleChange}
            value={controlValue}
          />
          {suffix && <InputRightAddon children={suffix} />}
        </InputGroup>
        {helperText && <FormHelperText>{helperText}</FormHelperText>}
        {error && <FormErrorMessage>{error}</FormErrorMessage>}
      </FormControl>
    );
  }
);

InputControlled.displayName = "InputControlled";

export default InputControlled;
