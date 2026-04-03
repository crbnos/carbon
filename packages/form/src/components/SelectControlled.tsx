import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel
} from "@carbon/react";
import { useEffect } from "react";

import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import type { SelectBaseProps } from "./Select";
import { SelectBase } from "./Select";

export type SelectProps = Omit<SelectBaseProps, "onChange"> & {
  name: string;
  label?: string;
  helperText?: string;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  options: { value: string | number; label: string | JSX.Element }[];
  onChange?: (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => void;
  onConfigure?: () => void;
};

const SelectControlled = ({
  name,
  label,
  helperText,
  options,
  isConfigured,
  isOptional,
  isRequired,
  onConfigure,
  ...props
}: SelectProps) => {
  const { getInputProps, error } = useField(name);
  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled || props.isDisabled;
  const isReadOnly = formState.isReadOnly || props.isReadOnly;
  const [controlValue, setControlValue] = useControlField<string | undefined>(
    name
  );

  useEffect(() => {
    if (props.value !== null && props.value !== undefined)
      setControlValue(props.value);
  }, [props.value, setControlValue]);

  const onChange = (value: string) => {
    if (value) {
      props?.onChange?.(options.find((o) => o.value === value) ?? null);
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
          isOptional={isOptional}
          onConfigure={onConfigure}
        >
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
        isDisabled={isDisabled}
        isReadOnly={isReadOnly}
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
