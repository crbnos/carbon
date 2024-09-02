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
import type { ChangeEvent } from "react";
import { forwardRef, useEffect } from "react";
import { useControlField, useField } from "../hooks";

type FormInputControlledProps = Omit<InputProps, "value" | "onChange"> & {
  name: string;
  label?: string;
  isUppercase?: boolean;
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
      isUppercase,
      ...rest
    },
    ref
  ) => {
    const { getInputProps, error } = useField(name);
    const [controlValue, setControlValue] = useControlField<string>(name);

    useEffect(() => {
      setControlValue(isUppercase ? uppercase(value) : value);
    }, [isUppercase, setControlValue, value]);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      setControlValue(e.target.value);
      if (onChange && typeof onChange === "function") {
        onChange(isUppercase ? uppercase(e.target.value) : e.target.value);
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

function uppercase(value?: string) {
  return value?.toUpperCase() ?? "";
}

InputControlled.displayName = "InputControlled";

export default InputControlled;
