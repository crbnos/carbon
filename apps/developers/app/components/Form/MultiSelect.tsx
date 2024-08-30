import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "@carbon/react";

import { useControlField, useField } from "@carbon/remix-validated-form";
import { MultiSelect as MultiSelectBase } from "~/components";
import type { MultiSelectProps as MultiSelectBaseProps } from "~/components/MultiSelect";

export type MultiSelectProps = Omit<
  MultiSelectBaseProps,
  "onChange" | "value"
> & {
  name: string;
  label?: string;
  helperText?: string;
  onChange?: (newValue: { value: string; label: string }[]) => void;
};

const MultiSelect = ({
  name,
  label,
  helperText,
  ...props
}: MultiSelectProps) => {
  const { error } = useField(name);
  const [value, setValue] = useControlField<string[]>(name);

  const onChange = (value: string[]) => {
    props?.onChange?.(props.options.filter((o) => value.includes(o.value)));
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && <FormLabel htmlFor={name}>{label}</FormLabel>}
      {value.filter(Boolean).map((selection, index) => (
        <input
          key={`${name}[${index}]`}
          type="hidden"
          name={`${name}[${index}]`}
          value={selection}
        />
      ))}
      <MultiSelectBase
        {...props}
        value={value.filter(Boolean)}
        onChange={(newValue) => {
          setValue(newValue ?? "");
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

MultiSelect.displayName = "MultiSelect";

export default MultiSelect;
