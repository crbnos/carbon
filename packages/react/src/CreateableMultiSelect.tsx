import { useLingui } from "@lingui/react/macro";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CommandEmpty } from "cmdk";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useId, useMemo, useRef, useState } from "react";
import { FaRegSquare, FaSquareCheck } from "react-icons/fa6";
import { LuCirclePlus, LuSettings2 } from "react-icons/lu";
import { RxMagnifyingGlass } from "react-icons/rx";
import { Badge, BadgeCloseButton } from "./Badge";
import { Button } from "./Button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  multiSelectTriggerVariants
} from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { TruncatedTooltipText } from "./TruncatedTooltipText";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";

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
      isReadOnly,
      placeholder,
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
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const id = useId();

    const handleUnselect = (item: string) => {
      onChange(value.filter((i) => i !== item));
    };

    const hasSelections = value.length > 0;
    const isInlinePreview = !!inline;
    const dropdownContentWidthCh = useMemo(() => {
      if (options.length === 0) return undefined;

      const maxOptionChars = options.reduce((longest, option) => {
        const combined = [option.label, option.helper]
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
        {isInlinePreview && Array.isArray(value) && value.length > 0 && (
          <span
            className="flex flex-grow line-clamp-1 items-center cursor-pointer"
            onClick={() => setOpen(true)}
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
              <Button
                aria-controls={id}
                aria-expanded={open}
                role="combobox"
                tabIndex={0}
                variant="secondary"
                className={cn(
                  multiSelectTriggerVariants({ size, hasSelections }),
                  "bg-transparent px-2",
                  className
                )}
                isDisabled={isReadOnly}
                onClick={() => {
                  if (!isReadOnly) setOpen(!open);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !isReadOnly) {
                    setOpen(!open);
                  }
                }}
                asChild
              >
                <div>
                  {hasSelections ? (
                    <div className="flex gap-1 flex-wrap">
                      {value.map((item) => (
                        <SelectedOption
                          key={item.toString()}
                          item={item}
                          options={options}
                          onUnselect={handleUnselect}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      {placeholder ?? t`Search...`}
                    </span>
                  )}

                  <RxMagnifyingGlass className="h-4 w-4 shrink-0 opacity-50" />
                </div>
              </Button>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="min-w-[--radix-popover-trigger-width] max-w-[min(560px,calc(100vw-2rem))] p-1"
            style={{
              width: dropdownContentWidthCh
                ? `min(560px, max(var(--radix-popover-trigger-width), ${dropdownContentWidthCh}ch))`
                : "var(--radix-popover-trigger-width)"
            }}
          >
            <VirtualizedCommand
              options={options}
              selected={value}
              onChange={onChange}
              onCreateOption={onCreateOption}
              itemHeight={itemHeight}
              setOpen={setOpen}
              label={label}
              createLabel={createLabel}
              search={search}
              setSearch={setSearch}
              showCreateOptionOnEmpty={showCreateOptionOnEmpty}
            />
          </PopoverContent>
        </Popover>
      </HStack>
    );
  }
);
CreatableMultiSelect.displayName = "CreatableMultiSelect";

export { CreatableMultiSelect };

type VirtualizedCommandProps = {
  options: CreatableMultiSelectProps["options"];
  selected: string[];
  onChange: (selected: string[]) => void;
  onCreateOption?: (inputValue: string) => void;
  itemHeight: number;
  setOpen: (open: boolean) => void;
  label?: string;
  createLabel?: string;
  search: string;
  setSearch: (search: string) => void;
  showCreateOptionOnEmpty?: boolean;
};

function VirtualizedCommand({
  options,
  selected,
  onChange,
  onCreateOption,
  itemHeight,
  setOpen,
  label,
  createLabel,
  search,
  setSearch,
  showCreateOptionOnEmpty = false
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

    const isExactMatch = options.some((option) =>
      [option.label.toLowerCase(), option.helper?.toLowerCase()].includes(
        search.toLowerCase()
      )
    );

    const trimmedSearch = search.trim();
    if (isExactMatch || (trimmedSearch === "" && !showCreateOptionOnEmpty)) {
      return filtered;
    }

    return [
      ...filtered,
      {
        label: t`New`,
        value: "create"
      }
    ];
  }, [options, search, showCreateOptionOnEmpty, t]);

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
        className="overflow-auto pt-1"
        style={{
          height: `${Math.min(filteredOptions.length, 6) * itemHeight + 4}px`
        }}
      >
        <CommandEmpty>{t`No option found.`}</CommandEmpty>
        <CommandGroup
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative"
          }}
        >
          {items.map((virtualRow) => {
            const item = filteredOptions[virtualRow.index]!;
            const isSelected = selected.includes(item.value);
            const isCreateOption = item.value === "create";
            const itemHoverText = [item.label, item.helper]
              .filter(Boolean)
              .join(" - ");

            return (
              <CommandItem
                key={item.value}
                value={
                  typeof item.label === "string"
                    ? item.label.replace(/"/g, '\\"') +
                      item.helper?.replace(/"/g, '\\"')
                    : undefined
                }
                onSelect={() => {
                  if (isCreateOption) {
                    onCreateOption?.(search);
                    setSearch("");
                  } else {
                    onChange(
                      isSelected
                        ? selected.filter((value) => value !== item.value)
                        : [...selected, item.value]
                    );
                  }
                  setOpen(true);
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
                <div className="flex justify-start items-center gap-1 px-2 min-w-0 flex-1">
                  {isCreateOption ? (
                    <>
                      <LuCirclePlus className="mr-1.5 flex-shrink-0" />
                      <span>{t`Create ${search.trim() === "" ? (createLabel ?? label) : search}`}</span>
                    </>
                  ) : (
                    <>
                      {isSelected ? (
                        <FaSquareCheck className="mr-1.5 text-primary flex-shrink-0" />
                      ) : (
                        <FaRegSquare className="mr-1.5 text-muted-foreground flex-shrink-0" />
                      )}
                      {item.helper ? (
                        <div className="flex flex-col min-w-0 flex-1">
                          <TruncatedTooltipText
                            className="block w-full truncate"
                            tooltip={itemHoverText}
                          >
                            {item.label}
                          </TruncatedTooltipText>
                          <TruncatedTooltipText
                            className="text-xs text-muted-foreground truncate"
                            tooltip={itemHoverText}
                          >
                            {item.helper}
                          </TruncatedTooltipText>
                        </div>
                      ) : (
                        <TruncatedTooltipText
                          className="truncate flex-1"
                          tooltip={itemHoverText}
                        >
                          {item.label}
                        </TruncatedTooltipText>
                      )}
                    </>
                  )}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </div>
    </Command>
  );
}

function SelectedOption({
  isReadOnly,
  item,
  options,
  onUnselect
}: {
  isReadOnly?: boolean;
  item: string;
  options: CreatableMultiSelectProps["options"];
  onUnselect: (item: string) => void;
}) {
  return (
    <Badge key={item} variant="secondary" className="border border-card">
      {options.find((option) => option.value === item)?.label}
      <BadgeCloseButton
        disabled={isReadOnly}
        tabIndex={-1}
        type="button"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isReadOnly) {
            onUnselect(item);
          }
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isReadOnly) onUnselect(item);
        }}
      />
    </Badge>
  );
}
