// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import {
  Select as CarbonSelect,
  cn,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  inlineTriggerClassName,
  LabelWithHelp,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner
} from "@carbon/react";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef } from "react";
import { LuX } from "react-icons/lu";
import { useControlField, useField } from "../hooks";
import { useFormStateContext } from "../internal/formStateContext";
import { useInlineField } from "../internal/inlineField";

export type SelectProps = Omit<SelectBaseProps, "onChange"> & {
  name: string;
  label?: string;
  termId?: TermId;
  helperText?: string;
  isConfigured?: boolean;
  isOptional?: boolean;
  isRequired?: boolean;
  onChange?: (
    newValue: { value: string; label: string | JSX.Element } | null
  ) => void;
  onConfigure?: () => void;
  emptyMessage?: ReactNode;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element }[]
  ) => JSX.Element;
};

const Select = ({
  name,
  label,
  termId,
  helperText,
  isConfigured = false,
  isOptional,
  isRequired,
  isLoading,
  options,
  onConfigure,
  emptyMessage,
  ...props
}: SelectProps) => {
  const { getInputProps, error, isOptional: fieldIsOptional } = useField(name);
  const [value, setValue] = useControlField<string | undefined>(name);
  const formState = useFormStateContext();
  const isDisabled = formState.isDisabled || props.isDisabled;
  const isReadOnly = formState.isReadOnly || props.isReadOnly;
  const resolvedIsOptional =
    isOptional ?? (isRequired ? false : (fieldIsOptional ?? false));
  const inlineField = useInlineField({
    inline: !!props.inline,
    label,
    isEmpty: !value,
    isReadOnly: isReadOnly || isDisabled
  });

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
      {label && inlineField.showLabel && (
        <FormLabel
          htmlFor={name}
          isOptional={resolvedIsOptional}
          isConfigured={isConfigured}
          onConfigure={onConfigure}
        >
          <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
        </FormLabel>
      )}

      <input
        {...getInputProps({
          id: name,
          value: value ?? ""
        })}
        type="hidden"
        name={name}
        id={name}
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
        emptyMessage={isLoading ? undefined : emptyMessage}
        inlinePlaceholder={inlineField.placeholder}
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
    helper?: string;
    helperRight?: string;
  }[];
  isClearable?: boolean;
  isDisabled?: boolean;
  isLoading?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
  emptyMessage?: ReactNode;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element }[]
  ) => JSX.Element;
  /** Inline mode: what the empty field reads, "Add milestone". */
  inlinePlaceholder?: ReactNode;
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
      emptyMessage,
      inline,
      inlinePlaceholder,
      onChange,
      ...props
    },
    ref
  ) => {
    const isInlinePreview = !!inline;
    const isNonInteractive = isReadOnly || isDisabled;

    return (
      // Phones: Radix's hidden native <select> follows the trigger, so a
      // space-x margin would end the trigger 4px short; use a gap instead.
      <HStack
        spacing={1}
        className={cn(
          "max-md:space-x-0 max-md:gap-1",
          isInlinePreview && "w-full"
        )}
      >
        <CarbonSelect
          value={value}
          onValueChange={(value) => onChange(value)}
          disabled={isNonInteractive}
        >
          <SelectTrigger
            ref={ref}
            size={size}
            {...props}
            className={cn(
              isInlinePreview
                ? inlineTriggerClassName
                : "min-w-[160px] relative"
            )}
            inline={isInlinePreview}
            disabled={isNonInteractive}
            hideIcon={isLoading}
          >
            {isInlinePreview ? (
              value ? (
                <span className="flex min-w-0 flex-1 items-center overflow-hidden">
                  {inline(value, options)}
                </span>
              ) : (
                <span className="truncate text-muted-foreground">
                  {inlinePlaceholder}
                </span>
              )
            ) : (
              <div className="min-w-0 flex-1 truncate text-left">
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
            {options.length === 0
              ? (emptyMessage ?? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No options available
                  </div>
                ))
              : options.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    helper={option.helper}
                    helperRight={option.helperRight}
                  >
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
