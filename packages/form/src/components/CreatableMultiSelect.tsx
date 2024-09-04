import type { CreatableMultiSelectProps as CreatableMultiSelectBaseProps } from "@carbon/react";
import {
  CreatableMultiSelect as CreatableMultiSelectBase,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
} from "@carbon/react";
import { forwardRef, useEffect } from "react";

import { useControlField, useField } from "../hooks";

export type CreatableMultiSelectProps = Omit<
  CreatableMultiSelectBaseProps,
  "onChange" | "value"
> & {
  name: string;
  label?: string;
  helperText?: string;
  isOptional?: boolean;
  value?: string[];
  onChange?: (newValue: string[]) => void;
};

const CreatableMultiSelect = forwardRef<
  HTMLButtonElement,
  CreatableMultiSelectProps
>(({ name, label, helperText, isOptional = false, ...props }, ref) => {
  const { error } = useField(name);
  const [value, setValue] = useControlField<string[] | undefined>(name);

  useEffect(() => {
    if (props.value !== null && props.value !== undefined)
      setValue(props.value);
  }, [props.value, setValue]);

  const onChange = (value: string[]) => {
    setValue(value);
    props.onChange?.(value);
  };

  return (
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel htmlFor={name} isOptional={isOptional}>
          {label}
        </FormLabel>
      )}
      {(value ?? []).filter(Boolean).map((selection, index) => (
        <input
          key={`${name}[${index}]`}
          type="hidden"
          name={`${name}[${index}]`}
          value={selection}
        />
      ))}
      <CreatableMultiSelectBase
        ref={ref}
        {...props}
        value={(value ?? []).map((v) => v.replace(/"/g, '\\"'))}
        onChange={(newValue) => {
          setValue((newValue ?? []).map((v) => v.replace(/"/g, '\\"') ?? ""));
          onChange((newValue ?? []).map((v) => v.replace(/"/g, '\\"') ?? ""));
        }}
        isClearable={isOptional && !props.isReadOnly}
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
});

CreatableMultiSelect.displayName = "CreatableMultiSelect";

export default CreatableMultiSelect;
