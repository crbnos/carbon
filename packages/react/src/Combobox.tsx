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
import { Spinner } from "./Spinner";
import { cn } from "./utils/cn";

export type ComboboxProps = Omit<
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
  isClearable?: boolean;
  isLoading?: boolean;
  isReadOnly?: boolean;
  placeholder?: string;
  onChange?: (selected: string) => void;
  inline?: (
    value: string,
    options: { value: string; label: string; helper?: string }[]
  ) => React.ReactNode;
  itemHeight?: number;
};

const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
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
    const [open, setOpen] = useState(false);
    const isInlinePreview = !!inline;

    return (
      <HStack
        className={cn(isInlinePreview ? "w-full" : "min-w-0 flex-grow")}
        spacing={isInlinePreview ? 2 : 1}
      >
        {isInlinePreview && value && (
          <span className="flex-grow line-clamp-1">
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
                size={size}
                role="combobox"
                className={cn(
                  "min-w-[160px]",
                  !value && "text-muted-foreground"
                )}
                icon={isLoading ? <Spinner /> : undefined}
                ref={ref}
                {...props}
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
            className="min-w-[260px] w-[--radix-popover-trigger-width] p-1"
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
  setOpen,
}: VirtualizedCommandProps) {
  const [search, setSearch] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    return search
      ? options.filter((option) => {
          return `${option.label} ${option.helper}`
            .toLowerCase()
            .includes(search.toLowerCase());
        })
      : options;
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
        className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent pt-1"
        style={{
          height: `${Math.min(filteredOptions.length, 6) * itemHeight + 4}px`,
        }}
      >
        <CommandGroup
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {items.map((virtualRow) => {
            const item = filteredOptions[virtualRow.index];

            return (
              <CommandItem
                key={item.value}
                value={
                  typeof item.label === "string"
                    ? CSS.escape(item.label) + CSS.escape(item.helper ?? "")
                    : undefined
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
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.helper ? (
                  <div className="flex flex-col pr-2">
                    <p className="line-clamp-1 w-full">{item.label}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {item.helper}
                    </p>
                  </div>
                ) : (
                  <span className="line-clamp-1 w-full pr-2">{item.label}</span>
                )}
                <LuCheck
                  className={cn(
                    "ml-auto h-4 w-4",
                    item.value === value ? "opacity-100" : "opacity-0"
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
