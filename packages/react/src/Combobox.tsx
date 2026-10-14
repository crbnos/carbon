// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { matchSorter, rankings } from "match-sorter";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef, useMemo, useState } from "react";
import { LuPlus, LuSettings2, LuX } from "react-icons/lu";
import { CommandTrigger } from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import type { PickerListOption } from "./PickerList";
import { PickerList } from "./PickerList";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Spinner } from "./Spinner";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString, withDistinctHelpers } from "./utils/react";
import { usePhoneOpenAutoFocus } from "./Viewport";

export type ComboboxOption = {
  label: string | JSX.Element;
  value: string;
  helper?: string;
  helperRight?: string;
  /** Extra search text, matched but never rendered. */
  keywords?: string;
};

/** Ranks options against the query. Defaults to `filterComboboxOptions`. */
export type ComboboxFilter = (
  options: ComboboxOption[],
  search: string
) => ComboboxOption[];

export type ComboboxProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  asButton?: boolean;
  size?: "sm" | "md" | "lg";
  value?: string;
  options: ComboboxOption[];
  filter?: ComboboxFilter;
  isClearable?: boolean;
  isLoading?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
  emptyMessage?: ReactNode;
  onChange?: (selected: string) => void;
  inline?: (
    value: string,
    options: { value: string; label: string | JSX.Element; helper?: string }[]
  ) => React.ReactNode;
  itemHeight?: number;
};

const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      asButton,
      size,
      value,
      options: optionsProp,
      filter,
      isClearable,
      isLoading,
      isReadOnly: isReadOnlyProp,
      disabled,
      placeholder,
      emptyMessage,
      onChange,
      inline,
      itemHeight = 40,
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
    // Treat the native `disabled` prop as equivalent to `isReadOnly`. The type
    // accepts `disabled` (it extends button props), so callers reasonably pass
    // it — honor it instead of silently overwriting it below.
    const isReadOnly = isReadOnlyProp || disabled;
    const [open, setOpen] = useState(false);
    const openAutoFocus = usePhoneOpenAutoFocus();
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
    // The list is virtualized (items are absolutely positioned), so the
    // popover can't size to its options naturally. Instead of estimating in
    // `ch` (which overestimates proportional text and made every popover wider
    // than its trigger), render the longest label in an invisible zero-height
    // sizer row — the browser measures the true text width and the popover
    // takes max(trigger width, real content width).
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
        spacing={isInlinePreview ? 2 : 1}
      >
        {isInlinePreview && value && (
          <span className="flex flex-grow line-clamp-1 items-center">
            {inline(value, options)}
          </span>
        )}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger disabled={isReadOnly} asChild>
            {inline ? (
              <IconButton
                size={size ?? "sm"}
                variant="secondary"
                aria-label={value ? "Edit" : "Add"}
                icon={value ? <LuSettings2 /> : <LuPlus />}
                isDisabled={isReadOnly}
                disabled={isReadOnly}
                ref={ref}
                onClick={() => {
                  if (!isReadOnly) setOpen(true);
                }}
              />
            ) : (
              <CommandTrigger
                asButton={asButton}
                size={size}
                role="combobox"
                className={cn(
                  "min-w-[160px]",
                  !value && "text-muted-foreground"
                )}
                icon={isLoading ? <Spinner className="size-3" /> : undefined}
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
            className="w-auto min-w-[max(var(--radix-popover-trigger-width),14rem)] max-w-[min(560px,calc(100vw-2rem))] p-1"
          >
            {/* Zero-height sizer: the widest option, so the auto width fits it
                even when virtualization keeps it unrendered. px-8 covers item
                padding + the selected-check icon + scrollbar. */}
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
                filter={filter ?? filterComboboxOptions}
                selectionMode="single"
                value={value}
                itemHeight={itemHeight}
                getItemValue={getComboboxItemValue}
                isChecked={(_, itemValue) => itemValue === value}
                isHelperPadded={(_, itemValue) => itemValue === value}
                emptyMessage={t`No option found.`}
                onSelect={(item, { setSearch }) => {
                  onChange?.(item.value);
                  setSearch("");
                  setOpen(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
        {isClearable && !isReadOnly && value && (
          <IconButton
            variant="ghost"
            aria-label="Clear"
            icon={<LuX />}
            onClick={() => onChange?.("")}
            size={size === "sm" ? "md" : size}
          />
        )}
      </HStack>
    );
  }
);
Combobox.displayName = "Combobox";

export { Combobox };

const labelOf = (option: ComboboxOption) =>
  typeof option.label === "string"
    ? option.label
    : reactNodeToString(option.label);

/**
 * Default search. Capped at CONTAINS because match-sorter's fuzzy tier matched
 * 278 of 419 timezones for "EST"; the joined key lets a query span fields
 * ("PART-001 Steel Bracket"), which per-key matching alone misses.
 */
export function filterComboboxOptions(
  options: ComboboxOption[],
  search: string
): ComboboxOption[] {
  if (!search) return options;
  return matchSorter(options, search, {
    threshold: rankings.CONTAINS,
    keys: [
      labelOf,
      (option) => option.helper ?? "",
      (option) => option.keywords ?? "",
      (option) =>
        [labelOf(option), option.helper, option.keywords]
          .filter(Boolean)
          .join(" ")
    ]
  });
}

const getComboboxItemValue = (item: PickerListOption) =>
  typeof item.label === "string"
    ? CSS.escape(item.label) + CSS.escape(item.helper ?? "")
    : reactNodeToString(item.label);
