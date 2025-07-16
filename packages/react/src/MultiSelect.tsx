import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useId, useMemo, useRef, useState } from "react";
import { FaRegSquare, FaSquareCheck } from "react-icons/fa6";
import { LuCirclePlus, LuSettings2, LuX } from "react-icons/lu";
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
import { HStack } from "./HStack";
import { IconButton } from "./IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { cn } from "./utils/cn";
import { reactNodeToString } from "./utils/react";

export type MultiSelectProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange" | "value"
> & {
  size?: "sm" | "md" | "lg";
  value: string[];
  options: {
    label: string;
    value: string;
    helper?: string;
  }[];
  isReadOnly?: boolean;
  isClearable?: boolean;
  placeholder?: string;
  onChange: (selected: string[]) => void;
  itemHeight?: number;
  maxPreview?: number;
  inline?: (
    value: string[],
    options: { value: string; label: string; helper?: string }[],
    maxPreview?: number
  ) => React.ReactNode;
  inlineIcon?: React.ReactElement;
};

const MultiSelect = forwardRef<HTMLButtonElement, MultiSelectProps>(
  (
    {
      size,
      value,
      options,
      isReadOnly,
      isClearable,
      placeholder,
      onChange,
      className,
      itemHeight = 40,
      maxPreview,
      inline,
      inlineIcon,
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");

    const id = useId();

    const handleUnselect = (item: string) => {
      onChange(value.filter((i) => i !== item));
    };

    const hasSelections = value.length > 0;
    const isInlinePreview = !!inline;

    return (
      <HStack
        className={cn(isInlinePreview ? "w-full" : "min-w-0 flex-grow")}
        spacing={1}
      >
        {isInlinePreview && Array.isArray(value) && value.length > 0 && (
          <span
            className={cn(
              "flex-grow line-clamp-1 cursor-pointer",
              isReadOnly && "cursor-default opacity-50"
            )}
            onClick={isReadOnly ? undefined : () => setOpen(true)}
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
                  "bg-transparent px-2 hover:scale-100 focus-visible:scale-100",
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
                        <Badge
                          key={item}
                          variant="secondary"
                          className="border border-card shadow-sm"
                        >
                          {
                            options.find((option) => option.value === item)
                              ?.label
                          }
                          <BadgeCloseButton
                            disabled={isReadOnly}
                            type="button"
                            tabIndex={-1}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !isReadOnly) {
                                handleUnselect(item);
                              }
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!isReadOnly) handleUnselect(item);
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
            )}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="min-w-[--radix-popover-trigger-width] p-1"
          >
            <VirtualizedCommand
              options={options}
              value={value}
              onChange={onChange}
              itemHeight={itemHeight}
              setOpen={setOpen}
              search={search}
              setSearch={setSearch}
            />
          </PopoverContent>
        </Popover>
        {isClearable && !isReadOnly && value.length > 0 && (
          <IconButton
            variant={isInlinePreview ? "secondary" : "ghost"}
            aria-label="Clear"
            icon={<LuX />}
            onClick={() => onChange([])}
            size={isInlinePreview ? "sm" : size}
          />
        )}
      </HStack>
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
  search: string;
  setSearch: (search: string) => void;
};

function VirtualizedCommand({
  options,
  value,
  onChange,
  itemHeight,
  setOpen,
  search,
  setSearch,
}: VirtualizedCommandProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    return search
      ? options.filter((option) => {
          const value =
            typeof option.label === "string"
              ? `${option.label} ${option.helper ?? ""}`
              : reactNodeToString(option.label);

          return value.toLowerCase().includes(search.toLowerCase());
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
      <CommandEmpty>No option found.</CommandEmpty>
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
            const option = filteredOptions[virtualRow.index];
            const isSelected = value.includes(option.value);

            return (
              <CommandItem
                key={option.value}
                value={
                  typeof option.label === "string"
                    ? option.label.replace(/"/g, '\\"') +
                      (option.helper?.replace(/"/g, '\\"') ?? "")
                    : undefined
                }
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
                  {option.helper ? (
                    <div className="flex flex-col">
                      <p className="line-clamp-1">{option.label}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {option.helper}
                      </p>
                    </div>
                  ) : (
                    <span className="line-clamp-1">{option.label}</span>
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
