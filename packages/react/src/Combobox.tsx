import { useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { matchSorter, rankings } from "match-sorter";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { forwardRef, useMemo, useRef, useState } from "react";
import { LuCheck, LuPlus, LuSettings2, LuX } from "react-icons/lu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandTrigger
} from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { Spinner } from "./Spinner";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";

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
      options,
      filter,
      isClearable,
      isLoading,
      isReadOnly,
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
    const [open, setOpen] = useState(false);
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
              <VirtualizedCommand
                options={options}
                filter={filter}
                value={value}
                onChange={onChange}
                itemHeight={itemHeight}
                setOpen={setOpen}
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

type VirtualizedCommandProps = {
  options: ComboboxOption[];
  filter?: ComboboxFilter;
  value?: string;
  onChange?: (selected: string) => void;
  itemHeight: number;
  setOpen: (open: boolean) => void;
};

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

function VirtualizedCommand({
  options,
  filter = filterComboboxOptions,
  value,
  onChange,
  itemHeight,
  setOpen
}: VirtualizedCommandProps) {
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(
    () => filter(options, search),
    [options, search, filter]
  );

  const virtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 12
  });

  const items = virtualizer.getVirtualItems();

  return (
    <Command shouldFilter={false}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={t`Search...`}
        className="h-9"
      />
      <CommandEmpty>{t`No option found.`}</CommandEmpty>
      <div
        ref={parentRef}
        className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent pt-1"
        style={{
          height: `${Math.min(filteredOptions.length, 6) * itemHeight + 4}px`
        }}
      >
        <CommandGroup
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative"
          }}
        >
          {items.map((virtualRow) => {
            const item = filteredOptions[virtualRow.index]!;
            const itemValue =
              typeof item.label === "string"
                ? CSS.escape(item.label) + CSS.escape(item.helper ?? "")
                : reactNodeToString(item.label);
            const itemHoverText =
              typeof item.label === "string"
                ? [item.label, item.helper].filter(Boolean).join(" - ")
                : [reactNodeToString(item.label), item.helper]
                    .filter(Boolean)
                    .join(" - ");

            return (
              <CommandItem
                key={item.value}
                value={
                  typeof item.label === "string"
                    ? CSS.escape(item.label) + CSS.escape(item.helper ?? "")
                    : reactNodeToString(item.label)
                }
                onSelect={() => {
                  onChange?.(item.value);
                  setSearch("");
                  setOpen(false);
                }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${itemHeight}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                {item.helper ? (
                  <div
                    className={cn(
                      "flex flex-col min-w-0 flex-1",
                      itemValue === value && "pr-2"
                    )}
                  >
                    <TruncatedTooltipText
                      className="block w-full truncate"
                      tooltip={itemHoverText}
                    >
                      {item.label}
                    </TruncatedTooltipText>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <TruncatedTooltipText
                        className="truncate flex-1"
                        tooltip={itemHoverText}
                      >
                        {item.helper}
                      </TruncatedTooltipText>
                      {item.helperRight && (
                        <span className="flex-shrink-0">
                          {item.helperRight}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <TruncatedTooltipText
                    className="truncate flex-1"
                    tooltip={itemHoverText}
                  >
                    {item.label}
                  </TruncatedTooltipText>
                )}
                <LuCheck
                  className={cn(
                    "ml-auto h-4 w-4",
                    itemValue === value ? "opacity-100" : "opacity-0 hidden"
                  )}
                />
              </CommandItem>
            );
          })}
        </CommandGroup>
      </div>
    </Command>
  );
}
