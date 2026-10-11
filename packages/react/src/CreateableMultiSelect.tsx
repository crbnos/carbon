// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef, useId, useMemo, useState } from "react";
import { LuCirclePlus, LuSettings2 } from "react-icons/lu";
import { CommandTrigger } from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import type { PickerListOption } from "./PickerList";
import { PickerList } from "./PickerList";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";
import { usePhoneOpenAutoFocus } from "./Viewport";

export type CreatableMultiSelectProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  size?: "sm" | "md" | "lg";
  value: string[];
  options: {
    label: string;
    value: string;
    helper?: string;
  }[];
  selected?: string[];
  isReadOnly?: boolean;
  label?: string;
  createLabel?: string;
  placeholder?: string;
  emptyMessage?: ReactNode;
  maxPreview?: number;
  itemHeight?: number;
  showCreateOptionOnEmpty?: boolean;
  inline?: (
    value: string[],
    options: { value: string; label: string; helper?: string }[],
    maxPreview?: number
  ) => React.ReactNode;
  inlineIcon?: React.ReactElement;
  onChange: (selected: string[]) => void;
  onCreateOption?: (inputValue: string) => void;
};

const CreatableMultiSelect = forwardRef<
  HTMLButtonElement,
  CreatableMultiSelectProps
>(
  (
    {
      size,
      value,
      options,
      selected,
      isReadOnly: isReadOnlyProp,
      disabled,
      placeholder,
      emptyMessage,
      label,
      createLabel,
      className,
      itemHeight = 40,
      maxPreview,
      showCreateOptionOnEmpty = true,
      inline,
      inlineIcon,
      onChange,
      onCreateOption,
      ...props
    },
    ref
  ) => {
    const { t } = useLingui();
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
    // Real-text sizer instead of a ch estimate — see Combobox.tsx.
    const longestOptionText = useMemo(() => {
      return options.reduce((longest, option) => {
        const combined = [option.label, option.helper]
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

        <Popover
          open={open}
          onOpenChange={(next) => setOpen(isReadOnly ? false : next)}
        >
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
                onClick={() => {
                  if (!isReadOnly) setOpen(true);
                }}
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
                    {placeholder ?? t`Search...`}
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
            className="w-auto min-w-[max(var(--radix-popover-trigger-width),11rem)] max-w-[min(560px,calc(100vw-2rem))] p-1"
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
                filter={filterCreatableMultiSelectOptions}
                selectionMode="multiple"
                itemHeight={itemHeight}
                search={search}
                onSearchChange={setSearch}
                creatable
                createLabel={createLabel ?? label}
                showCreateOptionOnEmpty={showCreateOptionOnEmpty}
                getItemValue={getCreatableMultiSelectItemValue}
                isChecked={(item) => value.includes(item.value)}
                emptyMessage={t`No matches. Type to create one.`}
                onSelect={(item, { isCreateOption }) => {
                  if (isCreateOption) {
                    onCreateOption?.(search);
                    setSearch("");
                  } else {
                    onChange(
                      value.includes(item.value)
                        ? value.filter((current) => current !== item.value)
                        : [...value, item.value]
                    );
                  }
                  setOpen(true);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </HStack>
    );
  }
);
CreatableMultiSelect.displayName = "CreatableMultiSelect";

export { CreatableMultiSelect };

const filterCreatableMultiSelectOptions = (
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

const getCreatableMultiSelectItemValue = (item: PickerListOption) =>
  typeof item.label === "string"
    ? item.label.replace(/"/g, '\\"') +
      (item.helper?.replace(/"/g, '\\"') ?? "")
    : undefined;
