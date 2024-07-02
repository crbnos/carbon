import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "@carbon/react";
import { forwardRef, useEffect } from "react";

import { useControlField, useField } from "@carbon/remix-validated-form";
import { CreatableCombobox as CreatableComboboxBase } from "~/components";
import type { CreatableComboboxProps as CreatableComboboxBaseProps } from "~/components/CreateableCombobox";

export type CreatableComboboxProps = Omit<
  CreatableComboboxBaseProps,
  "onChange"
> & {
  name: string;
  label?: string;
  helperText?: string;
  onChange?: (newValue: { value: string; label: string } | null) => void;
};

const CreatableCombobox = forwardRef<HTMLButtonElement, CreatableComboboxProps>(
  ({ name, label, helperText, ...props }, ref) => {
    const { getInputProps, error } = useField(name);
    const [value, setValue] = useControlField<string | undefined>(name);

    useEffect(() => {
      if (props.value) setValue(props.value);
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
        {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
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
          value={value}
          onChange={(newValue) => {
            setValue(newValue ?? "");
            onChange(newValue ?? "");
          }}
          label={label}
          className="w-full"
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
