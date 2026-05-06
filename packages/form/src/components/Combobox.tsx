import type { ComboboxProps as ComboboxBaseProps } from "@carbon/react";
import {
  Combobox as ComboboxBase,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel
} from "@carbon/react";
import { useEffect } from "react";
import { flushSync } from "react-dom";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

export type ComboboxProps = Omit<ComboboxBaseProps, "onChange"> & {
  name: string;
  label?: string;
  isLoading?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  helperText?: string;
  onChange?: (
    newValue: { value: string; label: string | React.ReactNode } | null
  ) => void;
  inline?: (
    value: string,
    options: {
      value: string;
      label: string | React.ReactNode;
      helper?: string;
    }[]
  ) => React.ReactNode;
};

const Combobox = ({
  name,
  label,
  isLoading = false,
  isOptional,
  isRequired,
  helperText,
  ...props
}: ComboboxProps) => {
  const { getInputProps, error, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);
  const formState = useFormStateContext();
  const isReadOnly =
    formState.isReadOnly || formState.isDisabled || props.isReadOnly;
  const resolvedIsOptional =
    isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

  useEffect(() => {
    if (props.value !== null && props.value !== undefined)
      setValue(props.value ?? "");
  }, [props.value, setValue]);

  const onChange = (value: string) => {
    if (value) {
      props?.onChange?.(props?.options.find((o) => o.value === value) ?? null);
    } else {
      props?.onChange?.(null);
    }
  };

  return (
    <FormControl isInvalid={!!error} isRequired={isRequired}>
      {label && (
        <FormLabel htmlFor={name} isOptional={resolvedIsOptional}>
          {label}
        </FormLabel>
      )}
      <input
        {...getInputProps({
          id: name
        })}
        type="hidden"
        name={name}
        id={name}
        value={value}
      />
      <ComboboxBase
        {...props}
        value={value}
        onChange={(newValue) => {
          flushSync(() => {
            setValue(newValue?.replace(/"/g, '\\"') ?? "");
          });
          onChange(newValue?.replace(/"/g, '\\"') ?? "");
        }}
        isClearable={resolvedIsOptional && !isReadOnly}
        isReadOnly={isReadOnly}
        isLoading={isLoading}
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

Combobox.displayName = "Combobox";

export default Combobox;
