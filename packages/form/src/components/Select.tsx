import {
  Select as CarbonSelect,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@carbon/react";

import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { MdClose } from "react-icons/md";
import { useControlField, useField } from "../hooks";

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

export type SelectBaseProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  size?: "sm" | "md" | "lg";
  value?: string;
  options: {
    label: string;
    value: string;
  }[];
  isClearable?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
  onChange: (selected: string) => void;
};

export const SelectBase = forwardRef<HTMLButtonElement, SelectBaseProps>(
  (
    {
      size,
      value,
      options,
      isClearable,
      isReadOnly,
      placeholder,
      onChange,
      ...props
    },
    ref
  ) => {
    return (
      <HStack spacing={1}>
        <CarbonSelect
          value={value}
          onValueChange={(value) => onChange(value)}
          disabled={isReadOnly}
        >
          <SelectTrigger
            ref={ref}
            size={size}
            // isReadOnly={isReadOnly}
            {...props}
            className="min-w-[160px]"
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </CarbonSelect>
        {isClearable && !isReadOnly && value && (
          <IconButton
            variant="ghost"
            aria-label="Clear"
            icon={<MdClose />}
            onClick={() => onChange("")}
            size={size === "sm" ? "md" : size}
          />
        )}
      </HStack>
    );
  }
);
SelectBase.displayName = "Select";
