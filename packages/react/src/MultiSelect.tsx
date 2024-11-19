import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useId, useMemo, useRef, useState } from "react";
import { FaRegSquare, FaSquareCheck } from "react-icons/fa6";
import { RxMagnifyingGlass } from "react-icons/rx";
import { Badge, BadgeCloseButton } from "./Badge";
import { Button } from "./Button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  multiSelectTriggerVariants,
} from "./Command";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { cn } from "./utils/cn";

export type MultiSelectProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange" | "value"
> & {
  size?: "sm" | "md" | "lg";
  value: string[];
  options: {
    label: string;
    value: string;
  }[];
  isReadOnly?: boolean;
  placeholder?: string;
  onChange: (selected: string[]) => void;
  itemHeight?: number;
};

const MultiSelect = forwardRef<HTMLButtonElement, MultiSelectProps>(
  (
    {
      size,
      value,
      options,
      isReadOnly,
      placeholder,
      onChange,
      className,
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
            onClick={() => setOpen(!open)}
            onKeyDown={() => setOpen(!open)}
            asChild
          >
            <div>
              {hasSelections ? (
                <div className="flex gap-1 flex-wrap">
                  {value.map((item) => (
                    <Badge
                      key={item}
                      variant="secondary"
                      className="border border-card"
                    >
                      {options.find((option) => option.value === item)?.label}
                      <BadgeCloseButton
                        type="button"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleUnselect(item);
                        }}
                      />
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {placeholder ?? "Select"}
                </span>
              )}

              <RxMagnifyingGlass className="h-4 w-4 shrink-0 opacity-50" />
            </div>
          </Button>
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
    );
  }
);
MultiSelect.displayName = "MultiSelect";

export { MultiSelect };

type VirtualizedCommandProps = {
  options: MultiSelectProps["options"];
  value: string[];
  onChange: (selected: string[]) => void;
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
      ? options.filter((option) =>
          option.label.toLowerCase().includes(search.toLowerCase())
        )
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
      <CommandEmpty>No option found.</CommandEmpty>
      <div
        ref={parentRef}
        className="overflow-auto pt-1"
        style={{
          height: `${Math.min(filteredOptions.length, 6) * itemHeight + 4}px`,
        }}
      >
        <CommandGroup
          className="pt-1"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {items.map((virtualRow) => {
            const option = filteredOptions[virtualRow.index];
            const isSelected = value.includes(option.value);

            return (
              <CommandItem
                key={option.value}
                onSelect={() => {
                  onChange(
                    isSelected
                      ? value.filter((item) => item !== option.value)
                      : [...value, option.value]
                  );
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
                <div className="flex items-center justify-start gap-2">
                  {isSelected ? (
                    <FaSquareCheck className="mr-1.5 text-primary" />
                  ) : (
                    <FaRegSquare className="mr-1.5 text-muted-foreground" />
                  )}
                  <span className="line-clamp-1">{option.label}</span>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </div>
    </Command>
  );
}
