import type { CreatableMultiSelectProps as CreatableMultiSelectBaseProps } from "@carbon/react";
import {
  CreatableMultiSelect as CreatableMultiSelectBase,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel
} from "@carbon/react";
import { forwardRef, useEffect, useMemo } from "react";

import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

export type CreatableMultiSelectProps = Omit<
  CreatableMultiSelectBaseProps,
  "onChange" | "value"
> & {
  name: string;
  label?: string;
  helperText?: string;
  isOptional?: boolean;
  isRequired?: boolean;
  value?: string[];
  onChange?: (newValue: string[]) => void;
};

const CreatableMultiSelect = forwardRef<
  HTMLButtonElement,
  CreatableMultiSelectProps
>(
  (
    {
      name,
      label,
      helperText,
      isOptional = false,
      isRequired = false,
      options = [],
      ...props
    },
    ref
  ) => {
    const { error } = useField(name);
    const [value, setValue] = useControlField<string[] | undefined>(name);
    const formState = useFormStateContext();
    const isReadOnly =
      formState.isReadOnly || formState.isDisabled || props.isReadOnly;

    useEffect(() => {
      if (props.value !== null && props.value !== undefined)
        setValue(props.value);
    }, [props.value, setValue]);

    const onChange = (value: string[]) => {
      setValue(value);
      props.onChange?.(value);
    };

    const sortedOptions = useMemo(() => {
      // Split options into selected and unselected
      const selectedOptions = options.filter((opt) =>
        value?.includes(opt.value)
      );
      const unselectedOptions = options.filter(
        (opt) => !value?.includes(opt.value)
      );

      // Sort unselected options alphabetically by label
      const sortedUnselected = [...unselectedOptions].sort((a, b) =>
        a.label.localeCompare(b.label)
      );

      // Combine selected options first, followed by sorted unselected options
      return [...selectedOptions, ...sortedUnselected];
    }, [options, value]);

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
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
          options={sortedOptions}
          value={value ?? []}
          onChange={(newValue) => {
            setValue(newValue ?? []);
            onChange(newValue ?? []);
          }}
          isClearable={isOptional && !isReadOnly}
          isReadOnly={isReadOnly}
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

CreatableMultiSelect.displayName = "CreatableMultiSelect";

export default CreatableMultiSelect;
