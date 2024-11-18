import type { CreatableComboboxProps as CreatableComboboxBaseProps } from "@carbon/react";
import {
  CreatableCombobox as CreatableComboboxBase,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "@carbon/react";
import { forwardRef, useEffect } from "react";

import { flushSync } from "react-dom";
import { useControlField, useField } from "../hooks";

export type CreatableComboboxProps = Omit<
  CreatableComboboxBaseProps,
  "onChange"
> & {
  name: string;
  label?: string;
  helperText?: string;
  isOptional?: boolean;
  inline?: (
    value: string,
    options: { value: string; label: string; helper?: string }[]
  ) => React.ReactNode;
  onChange?: (newValue: { value: string; label: string } | null) => void;
};

const CreatableCombobox = forwardRef<HTMLButtonElement, CreatableComboboxProps>(
  ({ name, label, helperText, isOptional = false, ...props }, ref) => {
    const { getInputProps, error } = useField(name);
    const [value, setValue] = useControlField<string | undefined>(name);

    useEffect(() => {
      if (props.value !== null && props.value !== undefined)
        setValue(props.value);
    }, [props.value, setValue]);

    const onChange = (value: string) => {
      if (value) {
        props?.onChange?.(props.options.find((o) => o.value === value) ?? null);
      } else {
        props?.onChange?.(null);
      }
    };

    return (
      <FormControl isInvalid={!!error}>
        {label && (
          <FormLabel htmlFor={name} isOptional={isOptional}>
            {label}
          </FormLabel>
        )}
        <input
          {...getInputProps({
            id: name,
          })}
          type="hidden"
          name={name}
          id={name}
          value={value}
        />
        <CreatableComboboxBase
          ref={ref}
          {...props}
          value={value?.replace(/"/g, '\\"')}
          isClearable={isOptional && !props.isReadOnly}
          label={label}
          className="w-full"
          onChange={(newValue) => {
            flushSync(() => {
              setValue(newValue?.replace(/"/g, '\\"') ?? "");
            });
            onChange(newValue?.replace(/"/g, '\\"') ?? "");
          }}
        />

        {error ? (
          <FormErrorMessage>{error}</FormErrorMessage>
        ) : (
          helperText && <FormHelperText>{helperText}</FormHelperText>
        )}
      </FormControl>
    );
  }
);

CreatableCombobox.displayName = "CreatableCombobox";

export default CreatableCombobox;
