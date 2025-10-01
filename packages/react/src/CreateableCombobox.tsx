import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useMemo, useRef, useState } from "react";
import { LuCheck, LuPlus, LuSettings2, LuX } from "react-icons/lu";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandTrigger,
} from "./Command";
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";

export type CreatableComboboxProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  size?: "sm" | "md" | "lg";
  value?: string;
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
  inline?: (
    value: string,
    options: { value: string; label: string; helper?: string }[]
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
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const isInlinePreview = !!inline;

    return (
      <HStack
        className={cn(isInlinePreview ? "w-full" : "min-w-0 flex-grow")}
        spacing={1}
      >
        {isInlinePreview && value && (
          <span className="flex-grow line-clamp-1">
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
                  options.find((option) => option.value === value)?.label
                ) : (
                  <span className="!text-muted-foreground">
                    {placeholder ?? "Select"}
                  </span>
                )}
              </CommandTrigger>
            )}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="min-w-[--radix-popover-trigger-width] max-w-[400px] p-1"
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
  setOpen,
}: VirtualizedCommandProps) {
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

    return isExactMatch
      ? filtered
      : [
          ...filtered,
          {
            label: `Create`,
            value: "create",
          },
        ];
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
      <CommandGroup>
        <div
          ref={parentRef}
          className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          style={{
            height: `${Math.min(filteredOptions.length, 6) * itemHeight + 4}px`,
          }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {items.map((virtualRow) => {
              const item = filteredOptions[virtualRow.index];

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
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex items-center justify-between min-w-0"
                >
                  {isCreateOption ? (
                    <div className="flex items-center min-w-0 flex-1">
                      <span>Create</span>
                      <span className="ml-1 font-bold truncate">
                        {search.trim() === "" ? label : search}
                      </span>
                    </div>
                  ) : item.helper ? (
                    <div className="flex flex-col min-w-0 flex-1">
                      <p className="truncate">{item.label}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.helper}
                      </p>
                    </div>
                  ) : (
                    <span className="truncate flex-1">{item.label}</span>
                  )}
                  {!isCreateOption && (
                    <LuCheck
                      className={cn(
                        "ml-auto h-4 w-4 flex-shrink-0",
                        isSelected || item.value === value
                          ? "opacity-100"
                          : "opacity-0"
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
