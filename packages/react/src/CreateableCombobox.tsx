// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { LuPlus, LuSettings2, LuX } from "react-icons/lu";
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

export type CreatableComboboxProps = Omit<
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
  selected?: string[];
  isClearable?: boolean;
  isReadOnly?: boolean;
  label?: string;
  placeholder?: string;
  emptyMessage?: ReactNode;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element; helper?: string }[]
  ) => React.ReactNode;
  inlineAddLabel?: string;
  onChange?: (selected: string) => void;
  onCreateOption?: (inputValue: string) => void;
  itemHeight?: number;
};

const CreatableCombobox = forwardRef<HTMLButtonElement, CreatableComboboxProps>(
  (
    {
      size,
      value,
      options: optionsProp,
      selected,
      isClearable,
      isReadOnly: isReadOnlyProp,
      disabled,
      placeholder,
      emptyMessage,
      onChange,
      label,
      itemHeight = 40,
      inline,
      inlineAddLabel,
      onCreateOption,
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

    // Reset the search box whenever the dropdown closes.
    useEffect(() => {
      if (!open) setSearch("");
    }, [open]);

    const isInlinePreview = !!inline;
    const selectedOption = useMemo(
      () => options.find((option) => option.value === value),
      [options, value]
    );
    const selectedOptionText = useMemo(() => {
      if (!selectedOption) return undefined;
      const labelText =
        typeof selectedOption.label === "string"
          ? selectedOption.label
          : reactNodeToString(selectedOption.label);

      return [labelText, selectedOption.helper].filter(Boolean).join(" - ");
    }, [selectedOption]);
    // Real-text sizer instead of a ch estimate — see Combobox.tsx.
    const longestOptionText = useMemo(() => {
      return options.reduce((longest, option) => {
        const labelText =
          typeof option.label === "string"
            ? option.label
            : reactNodeToString(option.label);
        const combined = [labelText, option.helper, option.helperRight]
          .filter(Boolean)
          .join(" ");

        return combined.length > longest.length ? combined : longest;
      }, "");
    }, [options]);

    return (
      <HStack
        className={cn(isInlinePreview ? "w-full" : "min-w-0 flex-grow")}
        spacing={1}
      >
        {isInlinePreview && value && (
          <span className="flex flex-grow line-clamp-1 items-center">
            {inline(value, options)}
          </span>
        )}

        {/* In inline mode the trigger is a non-button HStack, so its `disabled`
            is inert — guard onOpenChange so no surface can open while read-only. */}
        <Popover
          open={open}
          onOpenChange={(next) => setOpen(isReadOnly ? false : next)}
        >
          <PopoverTrigger disabled={isReadOnly} asChild>
            {inline ? (
              <HStack>
                <IconButton
                  size={size ?? "sm"}
                  variant="secondary"
                  aria-label={value ? "Edit" : "Add"}
                  icon={value ? <LuSettings2 /> : <LuPlus />}
                  ref={ref}
                  isDisabled={isReadOnly}
                  disabled={isReadOnly}
                  onClick={() => {
                    if (!isReadOnly) setOpen(true);
                  }}
                />
                {!value && inlineAddLabel && (
                  <span className="text-muted-foreground text-sm">
                    {inlineAddLabel}
                  </span>
                )}
              </HStack>
            ) : (
              <CommandTrigger
                size={size}
                role="combobox"
                className={cn(
                  "min-w-[160px]",
                  !value && "text-muted-foreground truncate"
                )}
                ref={ref}
                {...props}
                disabled={isReadOnly}
                onClick={() => setOpen(true)}
              >
                {value ? (
                  <TruncatedTooltipText
                    className="block min-w-0 flex-1 truncate text-left"
                    tooltip={selectedOptionText}
                  >
                    {selectedOption?.label}
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
            align="start"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onOpenAutoFocus={openAutoFocus}
            className={cn(
              "w-auto max-w-[min(560px,calc(100vw-2rem))] p-1",
              // Inline mode's trigger is a small icon button, so falling back to
              // the trigger width collapses the popover. Floor it to a usable width.
              inline
                ? "min-w-[220px]"
                : "min-w-[max(var(--radix-popover-trigger-width),14rem)]"
            )}
          >
            {/* Zero-height sizer: the widest option, so the auto width fits it
                even when virtualization keeps it unrendered. */}
            <div
              aria-hidden
              className="invisible h-0 overflow-hidden whitespace-nowrap px-8 text-sm"
            >
              {longestOptionText}
            </div>
            {emptyMessage && options.length === 0 ? (
              emptyMessage
            ) : (
              <PickerList
                options={options}
                filter={filterCreatableComboboxOptions}
                selectionMode="single"
                value={value}
                itemHeight={itemHeight}
                search={search}
                onSearchChange={setSearch}
                creatable
                createLabel={label}
                showCreateOptionOnEmpty
                getItemValue={getCreatableComboboxItemValue}
                isChecked={(item) =>
                  !!selected?.includes(item.value) || item.value === value
                }
                isHelperPadded={(item) =>
                  !selected?.includes(item.value) && item.value === value
                }
                onSelect={(item, { isCreateOption }) => {
                  if (isCreateOption) {
                    onCreateOption?.(search);
                  } else if (!selected?.includes(item.value)) {
                    onChange?.(item.value);
                    setSearch("");
                  }
                  setOpen(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
        {isClearable && !isReadOnly && value && (
          <IconButton
            variant={isInlinePreview ? "secondary" : "ghost"}
            aria-label="Clear"
            icon={<LuX />}
            onClick={() => onChange?.("")}
            size={isInlinePreview ? "sm" : size}
          />
        )}
      </HStack>
    );
  }
);
CreatableCombobox.displayName = "CreatableCombobox";

export { CreatableCombobox };

const filterCreatableComboboxOptions = (
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

const getCreatableComboboxItemValue = (item: PickerListOption) =>
  typeof item.label === "string"
    ? CSS.escape(item.label) + CSS.escape(item.helper ?? "")
    : undefined;
