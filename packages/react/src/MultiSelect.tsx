// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef, useId, useMemo, useState } from "react";
import { LuCirclePlus, LuSettings2, LuX } from "react-icons/lu";
import { CommandTrigger } from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import type { PickerListOption } from "./PickerList";
import { PickerList } from "./PickerList";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString, withDistinctHelpers } from "./utils/react";
import { usePhoneOpenAutoFocus } from "./Viewport";

export type MultiSelectProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange" | "value"
> & {
  size?: "sm" | "md" | "lg";
  value: string[];
  options: {
    label: string;
    value: string;
    helper?: string;
  }[];
  isReadOnly?: boolean;
  isClearable?: boolean;
  placeholder?: string;
  emptyMessage?: ReactNode;
  onChange: (selected: string[]) => void;
  itemHeight?: number;
  maxPreview?: number;
  inline?: (
    value: string[],
    options: { value: string; label: string; helper?: string }[],
    maxPreview?: number
  ) => React.ReactNode;
  inlineIcon?: React.ReactElement;
};

const MultiSelect = forwardRef<HTMLButtonElement, MultiSelectProps>(
  (
    {
      size,
      value,
      options: optionsProp,
      isReadOnly: isReadOnlyProp,
      disabled,
      isClearable,
      placeholder,
      emptyMessage,
      onChange,
      className,
      itemHeight = 40,
      maxPreview,
      inline,
      inlineIcon,
      ...props
    },
    ref
  ) => {
    const { t } = useLingui();
    // An item option's helper is its name, which for a service repeats the
    // readable id in the label.
    const options = useMemo(
      () => withDistinctHelpers(optionsProp),
      [optionsProp]
    );
    // Treat the native `disabled` prop as equivalent to `isReadOnly` — the type
    // accepts it (extends button props), so honor it rather than swallow it.
    const isReadOnly = isReadOnlyProp || disabled;
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const openAutoFocus = usePhoneOpenAutoFocus();

    const id = useId();

    const hasSelections = value.length > 0;
    const isInlinePreview = !!inline;

    const selectedLabels = value
      .map((item) => options.find((option) => option.value === item)?.label)
      .filter((label): label is string => Boolean(label));
    const selectedLabelText = selectedLabels.join(", ");

    return (
      <HStack
        className={cn(isInlinePreview ? "w-full" : "min-w-0 flex-grow")}
        spacing={1}
      >
        {isInlinePreview && Array.isArray(value) && value.length > 0 && (
          <span
            className={cn(
              "flex flex-grow line-clamp-1 items-center cursor-pointer",
              isReadOnly && "cursor-default opacity-50"
            )}
            onClick={isReadOnly ? undefined : () => setOpen(true)}
          >
            {inline(value, options, maxPreview)}
          </span>
        )}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            {inline ? (
              <IconButton
                size={size ?? "sm"}
                variant="secondary"
                aria-label={hasSelections ? "Edit" : "Add"}
                icon={
                  inlineIcon ? (
                    inlineIcon
                  ) : hasSelections ? (
                    <LuSettings2 />
                  ) : (
                    <LuCirclePlus />
                  )
                }
                ref={ref}
                isDisabled={isReadOnly}
                onClick={() => setOpen(true)}
              />
            ) : (
              <CommandTrigger
                aria-controls={id}
                aria-expanded={open}
                role="combobox"
                size={size}
                className={cn("min-w-[160px]", className)}
                ref={ref}
                disabled={isReadOnly}
                onClick={() => {
                  if (!isReadOnly) setOpen(!open);
                }}
              >
                {hasSelections ? (
                  <TruncatedTooltipText
                    className="block min-w-0 flex-1 truncate text-left"
                    tooltip={selectedLabelText}
                  >
                    {selectedLabelText}
                  </TruncatedTooltipText>
                ) : (
                  <span className="!text-muted-foreground">
                    {placeholder ?? t`Select`}
                  </span>
                )}
              </CommandTrigger>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onOpenAutoFocus={openAutoFocus}
            className="min-w-[var(--radix-popover-trigger-width)] p-1"
          >
            {emptyMessage && options.length === 0 ? (
              emptyMessage
            ) : (
              <PickerList
                options={options}
                filter={filterMultiSelectOptions}
                selectionMode="multiple"
                itemHeight={itemHeight}
                search={search}
                onSearchChange={setSearch}
                getItemValue={getMultiSelectItemValue}
                isChecked={(option) => value.includes(option.value)}
                emptyMessage={t`No option found.`}
                onSelect={(option) => {
                  onChange(
                    value.includes(option.value)
                      ? value.filter((item) => item !== option.value)
                      : [...value, option.value]
                  );
                  setOpen(true);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
        {isClearable && !isReadOnly && value.length > 0 && (
          <IconButton
            variant={isInlinePreview ? "secondary" : "ghost"}
            aria-label="Clear"
            icon={<LuX />}
            onClick={() => onChange([])}
            size={isInlinePreview ? "sm" : size}
          />
        )}
      </HStack>
    );
  }
);
MultiSelect.displayName = "MultiSelect";

export { MultiSelect };

const filterMultiSelectOptions = (
  options: PickerListOption[],
  search: string
) =>
  search
    ? options.filter((option) => {
        const value =
          typeof option.label === "string"
            ? `${option.label} ${option.helper ?? ""}`
            : reactNodeToString(option.label);

        return value.toLowerCase().includes(search.toLowerCase());
      })
    : options;

const getMultiSelectItemValue = (option: PickerListOption) =>
  typeof option.label === "string"
    ? option.label.replace(/"/g, '\\"') +
      (option.helper?.replace(/"/g, '\\"') ?? "")
    : undefined;
