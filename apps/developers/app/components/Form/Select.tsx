import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "@carbon/react";

import { useControlField, useField } from "@carbon/remix-validated-form";
import { Select as SelectBase } from "~/components";
import type { SelectProps as SelectBaseProps } from "~/components/Select";

export type SelectProps = Omit<SelectBaseProps, "onChange"> & {
  name: string;
  label?: string;
  helperText?: string;
  isOptional?: boolean;
  onChange?: (newValue: { value: string; label: string } | null) => void;
};

const Select = ({
  name,
  label,
  helperText,
  isOptional = false,
  ...props
}: SelectProps) => {
  const { getInputProps, error } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);

  const onChange = (value: string) => {
    if (value) {
      props?.onChange?.(props.options.find((o) => o.value === value) ?? null);
    } else {
      props?.onChange?.(null);
    }
  };

  return (
    <FormControl isInvalid={!!error} className={props.className}>
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
        value={value ?? undefined}
      />
      <SelectBase
        {...props}
        value={value}
        onChange={(newValue) => {
          setValue(newValue ?? "");
          onChange(newValue ?? "");
        }}
        isClearable={isOptional && !props.isReadOnly}
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

Select.displayName = "Select";

export default Select;
