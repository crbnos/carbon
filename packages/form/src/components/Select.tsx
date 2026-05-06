import {
  buttonVariants,
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
  Spinner
} from "@carbon/react";

import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";
import { LuPlus, LuSettings2, LuX } from "react-icons/lu";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";

export type SelectProps = Omit<SelectBaseProps, "onChange"> & {
  name: string;
  label?: string;
  helperText?: string;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  onChange?: (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => void;
  onConfigure?: () => void;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element }[]
  ) => JSX.Element;
};

const Select = ({
  name,
  label,
  helperText,
  isConfigured = false,
  isOptional,
  isRequired,
  isLoading,
  options,
  onConfigure,
  ...props
}: SelectProps) => {
  const { getInputProps, error, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);
  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled || props.isDisabled;
  const isReadOnly = formState.isReadOnly || props.isReadOnly;
  const resolvedIsOptional =
    isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));

  const onChange = (value: string) => {
    if (value) {
      props?.onChange?.(options.find((o) => o.value === value) ?? null);
    } else {
      props?.onChange?.(null);
    }
  };

  return (
    <FormControl
      isInvalid={!!error}
      isRequired={isRequired}
      className={props.className}
    >
      {label && (
        <FormLabel
          htmlFor={name}
          isOptional={resolvedIsOptional}
          isConfigured={isConfigured}
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
        isClearable={resolvedIsOptional && !isReadOnly}
        isDisabled={isDisabled}
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

Select.displayName = "Select";

const iconSizeClass = (size: "sm" | "md" | "lg") =>
  size === "lg" ? "size-5" : size === "md" ? "size-4" : "size-3.5";

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
  isDisabled?: boolean;
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
      isDisabled,
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
    const isNonInteractive = isReadOnly || isDisabled;

    return (
      <HStack spacing={1}>
        {isInlinePreview && value && (
          <span className="flex flex-grow line-clamp-1 items-center">
            {inline(value, options)}
          </span>
        )}

        <CarbonSelect
          value={value}
          onValueChange={(value) => onChange(value)}
          disabled={isNonInteractive}
        >
          <SelectTrigger
            ref={ref}
            size={size}
            {...props}
            className={cn(!isInlinePreview && "min-w-[160px] relative")}
            inline={isInlinePreview}
            disabled={isNonInteractive}
            hideIcon={isLoading}
          >
            {isInlinePreview ? (
              <span
                aria-hidden
                className={cn(
                  buttonVariants({
                    variant: "secondary",
                    size: size ?? "sm",
                    isIcon: true,
                    isDisabled: isNonInteractive
                  })
                )}
              >
                {value ? (
                  <LuSettings2 className={iconSizeClass(size ?? "sm")} />
                ) : (
                  <LuPlus className={iconSizeClass(size ?? "sm")} />
                )}
              </span>
            ) : (
              <div>
                <SelectValue placeholder={placeholder} />
                {isLoading && (
                  <div className="absolute top-3 right-2">
                    <Spinner className="size-3" />
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
        {isClearable && !isNonInteractive && value && (
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
