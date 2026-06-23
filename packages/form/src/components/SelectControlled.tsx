import type { TermId } from "@carbon/glossary";
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  LabelWithHelp
} from "@carbon/react";
import { useEffect } from "react";

import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import type { SelectBaseProps } from "./Select";
import { SelectBase } from "./Select";

export type SelectProps = Omit<SelectBaseProps, "onChange"> & {
  name: string;
  label?: string;
  termId?: TermId;
  helperText?: string;
  isConfigured?: boolean;
  isOptional?: boolean;
  options: { value: string | number; label: string | JSX.Element }[];
  onChange?: (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => void;
  onConfigure?: () => void;
};

const SelectControlled = ({
  name,
  label,
  termId,
  helperText,
  options,
  isConfigured,
  isOptional,
  onConfigure,
  ...props
}: SelectProps) => {
  const { getInputProps, error, isOptional: fieldIsOptional } = useField(name);
  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled || props.isDisabled;
  const isReadOnly = formState.isReadOnly || props.isReadOnly;
  const resolvedIsOptional = isOptional ?? fieldIsOptional ?? false;
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
    <FormControl isInvalid={!!error}>
      {label && (
        <FormLabel
          htmlFor={name}
          isConfigured={isConfigured}
          isOptional={resolvedIsOptional}
          onConfigure={onConfigure}
        >
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
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
        isClearable={resolvedIsOptional && !isReadOnly}
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
