import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "@carbon/react";
import { useEffect } from "react";

import { useControlField, useField } from "@carbon/remix-validated-form";
import { Select as SelectBase } from "~/components";
import type { SelectProps as SelectBaseProps } from "~/components/Select";

export type SelectProps = Omit<SelectBaseProps, "onChange"> & {
  name: string;
  label?: string;
  helperText?: string;
  options: { value: string | number; label: string }[];
  onChange?: (newValue: { value: string; label: string } | null) => void;
};

const SelectControlled = ({
  name,
  label,
  helperText,
  options,
  ...props
}: SelectProps) => {
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
      <SelectBase
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

SelectControlled.displayName = "SelectControlled";

export default SelectControlled;
