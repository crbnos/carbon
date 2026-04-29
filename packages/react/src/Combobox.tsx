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
import { Spinner } from "./Spinner";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";

export type ComboboxProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  asButton?: boolean;
  size?: "sm" | "md" | "lg";
  value?: string;
  options: {
    label: string | JSX.Element;
    value: string;
    helper?: string;
    helperRight?: string;
  }[];
  isClearable?: boolean;
  isLoading?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
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
      isClearable,
      isLoading,
      isReadOnly,
      placeholder,
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
              options={options}
              value={value}
              onChange={onChange}
              itemHeight={itemHeight}
              setOpen={setOpen}
            />
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
  options: ComboboxProps["options"];
  value?: string;
  onChange?: (selected: string) => void;
  itemHeight: number;
  setOpen: (open: boolean) => void;
};

function VirtualizedCommand({
  options,
  value,
  onChange,
  itemHeight,
  setOpen
}: VirtualizedCommandProps) {
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    return search
      ? options.filter((option) => {
          const value =
            typeof option.label === "string"
              ? `${option.label} ${option.helper}`
              : reactNodeToString(option.label);

          return value.toLowerCase().includes(search.toLowerCase());
        })
      : options;
  }, [options, search]);

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
