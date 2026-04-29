import { useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useMemo, useRef, useState } from "react";
import { LuCheck, LuPlus, LuSettings2, LuX } from "react-icons/lu";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandTrigger
} from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";

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
      options,
      selected,
      isClearable,
      isReadOnly,
      placeholder,
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
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
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
    const dropdownContentWidthCh = useMemo(() => {
      if (options.length === 0) return undefined;

      const maxOptionChars = options.reduce((longest, option) => {
        const labelText =
          typeof option.label === "string"
            ? option.label
            : reactNodeToString(option.label);
        const combined = [labelText, option.helper, option.helperRight]
          .filter(Boolean)
          .join(" ");

        return Math.max(longest, combined.length);
      }, 0);

      return Math.min(72, Math.max(36, maxOptionChars + 8));
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

        <Popover open={open} onOpenChange={setOpen}>
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
            className="min-w-[--radix-popover-trigger-width] max-w-[min(560px,calc(100vw-2rem))] p-1"
            style={{
              width: dropdownContentWidthCh
                ? `min(560px, max(var(--radix-popover-trigger-width), ${dropdownContentWidthCh}ch))`
                : "var(--radix-popover-trigger-width)"
            }}
          >
            <VirtualizedCommand
              label={label}
              options={options}
              selected={selected}
              value={value}
              itemHeight={itemHeight}
              search={search}
              onChange={onChange}
              onCreateOption={onCreateOption}
              setOpen={setOpen}
              setSearch={setSearch}
            />
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

type VirtualizedCommandProps = {
  options: CreatableComboboxProps["options"];
  selected?: string[];
  value?: string;
  label?: string;
  itemHeight: number;
  search: string;
  onChange?: (selected: string) => void;
  onCreateOption?: (inputValue: string) => void;
  setOpen: (open: boolean) => void;
  setSearch: (search: string) => void;
};

function VirtualizedCommand({
  options,
  label,
  selected,
  value,
  itemHeight,
  search,
  setSearch,
  onChange,
  onCreateOption,
  setOpen
}: VirtualizedCommandProps) {
  const { t } = useLingui();
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    const filtered = search
      ? options.filter((option) => {
          const value =
            typeof option.label === "string"
              ? `${option.label} ${option.helper}`
              : reactNodeToString(option.label);

          return value.toLowerCase().includes(search.toLowerCase());
        })
      : options;

    const isExactMatch = options.some((option) => {
      const labelValue =
        typeof option.label === "string"
          ? option.label
          : reactNodeToString(option.label);
      return [labelValue.toLowerCase(), option.helper?.toLowerCase()].includes(
        search.toLowerCase()
      );
    });

    return isExactMatch
      ? filtered
      : [
          ...filtered,
          {
            label: t`New`,
            value: "create"
          }
        ];
  }, [options, search, t]);

  const virtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5
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
      <CommandGroup>
        <div
          ref={parentRef}
          className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          style={{
            height: `${Math.min(filteredOptions.length, 6) * itemHeight + 4}px`
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative"
            }}
          >
            {items.map((virtualRow) => {
              const item = filteredOptions[virtualRow.index]!;
              const itemHoverText =
                typeof item.label === "string"
                  ? [item.label, item.helper].filter(Boolean).join(" - ")
                  : [reactNodeToString(item.label), item.helper]
                      .filter(Boolean)
                      .join(" - ");

              const isSelected = !!selected?.includes(item.value);
              const isCreateOption = item.value === "create";

              return (
                <CommandItem
                  key={item.value}
                  value={
                    typeof item.label === "string"
                      ? CSS.escape(item.label) + CSS.escape(item.helper ?? "")
                      : undefined
                  }
                  onSelect={() => {
                    if (isCreateOption) {
                      onCreateOption?.(search);
                    } else if (!isSelected) {
                      onChange?.(item.value);
                      setSearch("");
                    }
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
                  className="flex items-center justify-between min-w-0"
                >
                  {isCreateOption ? (
                    <div className="flex items-center min-w-0 flex-1">
                      <span>
                        {t`Create ${search.trim() === "" ? label : search}`}
                      </span>
                    </div>
                  ) : item.helper ? (
                    <div
                      className={cn(
                        "flex flex-col min-w-0 flex-1",
                        isSelected || (item.value === value && "pr-2")
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
                  {!isCreateOption && (
                    <LuCheck
                      className={cn(
                        "ml-auto h-4 w-4 flex-shrink-0",
                        isSelected || item.value === value
                          ? "opacity-100"
                          : "opacity-0 hidden"
                      )}
                    />
                  )}
                </CommandItem>
              );
            })}
          </div>
        </div>
      </CommandGroup>
    </Command>
  );
}
