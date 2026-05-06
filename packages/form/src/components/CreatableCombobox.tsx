import type { CreatableComboboxProps as CreatableComboboxBaseProps } from "@carbon/react";
import {
  CreatableCombobox as CreatableComboboxBase,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel
} from "@carbon/react";
import { forwardRef, useEffect } from "react";

import { flushSync } from "react-dom";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

export type CreatableComboboxProps = Omit<
  CreatableComboboxBaseProps,
  "onChange"
> & {
  autoSelectSingleOption?: boolean;
  isClearable?: boolean;
  name: string;
  label?: string | JSX.Element;
  helperText?: string;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element; helper?: string }[]
  ) => React.ReactNode;
  onChange?: (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => void;
  onConfigure?: () => void;
};

const CreatableCombobox = forwardRef<HTMLButtonElement, CreatableComboboxProps>(
  (
    {
      autoSelectSingleOption = false,
      isClearable,
      name,
      label,
      helperText,
      isConfigured = false,
      isOptional,
      isRequired,
      onConfigure,
      ...props
    },
    ref
  ) => {
    const {
      getInputProps,
      error,
      isOptional: fieldIsOptional
    } = useField(name);
    const [value, setValue] = useControlField<string | undefined>(name);
    const formState = useFormStateContext();
    const isReadOnly =
      formState.isReadOnly || formState.isDisabled || props.isReadOnly;
    const resolvedIsOptional =
      isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

    useEffect(() => {
      if (props.value !== null && props.value !== undefined)
        setValue(props.value);
    }, [props.value, setValue]);

    useEffect(() => {
      if (
        autoSelectSingleOption &&
        props.options.length === 1 &&
        !value // Only auto-select if no value is already set
      ) {
        setValue(props.options[0]!.value);
      }
    }, [autoSelectSingleOption, props.options, setValue, value]);

    const onChange = (value: string) => {
      if (value) {
        props?.onChange?.(props.options.find((o) => o.value === value) ?? null);
      } else {
        props?.onChange?.(null);
      }
    };

    return (
      <FormControl isInvalid={!!error} isRequired={isRequired}>
        {label && (
          <FormLabel
            htmlFor={name}
            isConfigured={isConfigured}
            onConfigure={onConfigure}
            isOptional={resolvedIsOptional}
          >
            {label}
          </FormLabel>
        )}
        <input
          {...getInputProps({
            id: name,
            value: value
          })}
          type="hidden"
          name={name}
          id={name}
        />
        <CreatableComboboxBase
          ref={ref}
          {...props}
          value={value?.replace(/"/g, '\\"')}
          isClearable={isClearable ?? (resolvedIsOptional && !isReadOnly)}
          isReadOnly={isReadOnly}
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
