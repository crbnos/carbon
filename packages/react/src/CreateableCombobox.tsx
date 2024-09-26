import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useMemo, useRef, useState } from "react";
import { FaRegSquare, FaSquareCheck } from "react-icons/fa6";
import { LuPlus } from "react-icons/lu";
import { MdClose } from "react-icons/md";
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
      onCreateOption,
      itemHeight = 40,
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);

    return (
      <HStack className="w-full" spacing={1}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <CommandTrigger
              size={size}
              role="combobox"
              className={cn("min-w-[160px]", !value && "text-muted-foreground")}
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
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="min-w-[260px] w-[--radix-popover-trigger-width] p-1"
          >
            <VirtualizedCommand
              label={label}
              options={options}
              selected={selected}
              value={value}
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
            onClick={() => onChange?.("")}
            size={size === "sm" ? "md" : size}
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
  onChange?: (selected: string) => void;
  onCreateOption?: (inputValue: string) => void;
  itemHeight: number;
  setOpen: (open: boolean) => void;
};

function VirtualizedCommand({
  options,
  label,
  selected,
  value,
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
      <div
        ref={parentRef}
        className="overflow-auto pt-1"
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

            const isSelected = !!selected?.includes(item.value);
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
              >
                <div className="flex justify-start items-center gap-1 px-2">
                  {isCreateOption ? (
                    <>
                      <LuPlus className="mr-1.5" />
                      <span>Create</span>
                      <span className="font-bold line-clamp-1">
                        {search.trim() === "" ? label : search}
                      </span>
                    </>
                  ) : (
                    <>
                      {isSelected || item.value === value ? (
                        <FaSquareCheck className="mr-1.5 text-primary" />
                      ) : (
                        <FaRegSquare className="mr-1.5 text-muted-foreground" />
                      )}
                      {item.helper ? (
                        <div className="flex flex-col">
                          <p>{item.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.helper}
                          </p>
                        </div>
                      ) : (
                        item.label
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
