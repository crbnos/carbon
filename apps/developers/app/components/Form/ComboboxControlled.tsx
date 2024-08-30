import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "@carbon/react";
import { useEffect } from "react";

import { useControlField, useField } from "@carbon/remix-validated-form";
import { Combobox as ComboboxBase } from "~/components";
import type { ComboboxProps as ComboboxBaseProps } from "~/components/Combobox";

export type ComboboxProps = Omit<ComboboxBaseProps, "onChange"> & {
  name: string;
  label?: string;
  helperText?: string;
  options: { value: string | number; label: string }[];
  onChange?: (newValue: { value: string; label: string } | null) => void;
};

const ComboboxControlled = ({
  name,
  label,
  helperText,
  options,
  ...props
}: ComboboxProps) => {
  const { getInputProps, error } = useField(name);
  const [controlValue, setControlValue] = useControlField<string | undefined>(
    name
  );

  useEffect(() => {
    setControlValue(props.value ?? "");
  }, [props.value, setControlValue]);

  const onChange = (value: string) => {
    if (value) {
      props?.onChange?.(options.find((o) => o.value === value) ?? null);
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
        value={controlValue}
      />
      <ComboboxBase
        {...props}
        options={options}
        value={controlValue}
        onChange={(newValue) => {
          setControlValue(newValue ?? "");
          onChange(newValue ?? "");
        }}
        className="w-full"
      />

      {error ? (
        <FormErrorMessage>{error}</FormErrorMessage>
      ) : (
        helperText && <FormHelperText>{helperText}</FormHelperText>
      )}
    </FormControl>
  );
};

ComboboxControlled.displayName = "ComboboxControlled";

export default ComboboxControlled;
