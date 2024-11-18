import {
  Select as CarbonSelect,
  cn,
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
  Spinner,
} from "@carbon/react";

import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { LuPlus, LuSettings2, LuX } from "react-icons/lu";
import { useControlField, useField } from "../hooks";

export type SelectProps = Omit<SelectBaseProps, "onChange"> & {
  name: string;
  label?: string;
  helperText?: string;
  isOptional?: boolean;
  onChange?: (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => void;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element }[]
  ) => JSX.Element;
};

const Select = ({
  name,
  label,
  helperText,
  isOptional = false,
  isLoading,
  options,
  ...props
}: SelectProps) => {
  const { getInputProps, error } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);

  const onChange = (value: string) => {
    if (value) {
      props?.onChange?.(options.find((o) => o.value === value) ?? null);
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
        options={options}
        value={value}
        onChange={(newValue) => {
          setValue(newValue ?? "");
          onChange(newValue ?? "");
        }}
        isClearable={isOptional && !props.isReadOnly}
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

Select.displayName = "Select";

export default Select;

export type SelectBaseProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  size?: "sm" | "md" | "lg";
  value?: string;
  options: {
    label: string | JSX.Element;
    value: string;
  }[];
  isClearable?: boolean;
  isLoading?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element }[]
  ) => JSX.Element;
  onChange: (selected: string) => void;
};

export const SelectBase = forwardRef<HTMLButtonElement, SelectBaseProps>(
  (
    {
      size,
      value,
      options,
      isClearable,
      isLoading,
      isReadOnly,
      placeholder,
      inline,
      onChange,
      ...props
    },
    ref
  ) => {
    const isInlinePreview = !!inline;

    return (
      <HStack spacing={1}>
        {isInlinePreview && value && (
          <span className="flex-grow line-clamp-1">
            {inline(value, options)}
          </span>
        )}

        <CarbonSelect
          value={value}
          onValueChange={(value) => onChange(value)}
          disabled={isReadOnly}
        >
          <SelectTrigger
            ref={ref}
            size={size}
            {...props}
            className={cn(!isInlinePreview && "min-w-[160px] relative")}
            inline={isInlinePreview}
            hideIcon={isLoading}
          >
            {isInlinePreview ? (
              <IconButton
                size={size ?? "sm"}
                variant="secondary"
                aria-label={value ? "Edit" : "Add"}
                icon={value ? <LuSettings2 /> : <LuPlus />}
              />
            ) : (
              <div>
                <SelectValue placeholder={placeholder} />
                {isLoading && (
                  <div className="absolute top-3 right-2">
                    <Spinner />
                  </div>
                )}
              </div>
            )}
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
            icon={<LuX />}
            onClick={() => onChange("")}
            size={size === "sm" ? "md" : size}
          />
        )}
      </HStack>
    );
  }
);
SelectBase.displayName = "Select";
