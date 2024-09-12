import { useVirtualizer } from "@tanstack/react-virtual";
import { CommandEmpty } from "cmdk";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useId, useMemo, useRef, useState } from "react";
import { MdClose } from "react-icons/md";
import { RxCheck, RxMagnifyingGlass } from "react-icons/rx";
import { Badge, BadgeCloseButton } from "./Badge";
import { Button } from "./Button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  multiSelectTriggerVariants,
} from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { cn } from "./utils/cn";

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
  isClearable?: boolean;
  isReadOnly?: boolean;
  label?: string;
  placeholder?: string;
  onChange: (selected: string[]) => void;
  onCreateOption?: (inputValue: string) => void;
  itemHeight?: number;
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
      isClearable,
      isReadOnly,
      placeholder,
      onChange,
      label,
      className,
      onCreateOption,
      itemHeight = 40,
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);

    const id = useId();

    const handleUnselect = (item: string) => {
      onChange(value.filter((i) => i !== item));
    };

    const hasSelections = value.length > 0;

    return (
      <HStack spacing={1}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
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
                    {placeholder ?? "Search..."}
                  </span>
                )}

                <RxMagnifyingGlass className="h-4 w-4 shrink-0 opacity-50" />
              </div>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="min-w-[260px] w-[--radix-popover-trigger-width] p-0"
          >
            <VirtualizedCommand
              options={options}
              selected={value}
              onChange={onChange}
              onCreateOption={onCreateOption}
              itemHeight={itemHeight}
              setOpen={setOpen}
            />
          </PopoverContent>
        </Popover>
        {isClearable && !isReadOnly && value && (
          <IconButton
            variant="ghost"
            aria-label="Clear"
            icon={<MdClose />}
            onClick={() => onChange?.([])}
            size={size === "sm" ? "md" : size}
          />
        )}
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
};

function VirtualizedCommand({
  options,
  selected,
  onChange,
  onCreateOption,
  itemHeight,
  setOpen,
}: VirtualizedCommandProps) {
  const [search, setSearch] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    const filtered = search
      ? options.filter((option) => {
          return `${option.label} ${option.helper}`
            .toLowerCase()
            .includes(search.toLowerCase());
        })
      : options;

    if (
      !options.some((option) =>
        [option.label.toLowerCase(), option.helper?.toLowerCase()].includes(
          search.toLowerCase()
        )
      ) &&
      search.trim() !== ""
    ) {
      filtered.push({
        label: `Create "${search}"`,
        value: "create",
      });
    }

    return filtered;
  }, [options, search]);

  const virtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <Command shouldFilter={false}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search..."
        className="h-9"
      />
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{
          height: `${Math.min(filteredOptions.length, 6) * itemHeight}px`,
        }}
      >
        <CommandEmpty>No option found.</CommandEmpty>
        <CommandGroup
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {items.map((virtualRow) => {
            const item = filteredOptions[virtualRow.index];
            const isSelected = selected.includes(item.value);
            const isCreateOption = item.value === "create";

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
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {isCreateOption ? (
                  <>
                    <span>Create</span>
                    <span className="ml-1 font-bold line-clamp-1">
                      {search}
                    </span>
                  </>
                ) : item.helper ? (
                  <div className="flex flex-col">
                    <p>{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.helper}
                    </p>
                  </div>
                ) : (
                  item.label
                )}
                {!isCreateOption && (
                  <RxCheck
                    className={cn(
                      "ml-auto h-4 w-4",
                      isSelected ? "opacity-100" : "opacity-0"
                    )}
                  />
                )}
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
  onUnselect,
}: {
  isReadOnly?: boolean;
  item: string;
  options: CreatableMultiSelectProps["options"];
  onUnselect: (item: string) => void;
}) {
  return (
    <Badge
      key={item}
      onClick={() => onUnselect(item)}
      variant="secondary"
      className="border border-border shadow-sm"
    >
      {options.find((option) => option.value === item)?.label}
      <BadgeCloseButton
        tabIndex={-1}
        disabled={isReadOnly}
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
