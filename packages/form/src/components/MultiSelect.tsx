import type { MultiSelectProps as MultiSelectBaseProps } from "@carbon/react";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  MultiSelect as MultiSelectBase,
} from "@carbon/react";

import { useControlField, useField } from "../hooks";
import { useEffect } from "react";

export type MultiSelectProps = Omit<
  MultiSelectBaseProps,
  "onChange" | "value"
> & {
  name: string;
  label?: string;
  helperText?: string;
  value?: string[];
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

  useEffect(() => {
    if (props.value !== null && props.value !== undefined)
      setValue(props.value);
  }, [props.value, setValue]);

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
          setValue(newValue ?? []);
          onChange(newValue ?? []);
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
