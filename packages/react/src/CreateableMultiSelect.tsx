import { CommandEmpty } from "cmdk";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useId, useState } from "react";
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
import { ScrollArea } from "./ScrollArea";
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
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const isExactMatch = options.some((option) =>
      [option.label.toLowerCase(), option.helper?.toLowerCase()].includes(
        search.toLowerCase()
      )
    );

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
          <PopoverContent className="min-w-[200px] w-[--radix-popover-trigger-width] p-0">
            <Command>
              <CommandInput
                placeholder="Search..."
                value={search}
                onValueChange={setSearch}
                className="h-9"
              />
              <ScrollArea className="overflow-auto max-h-96">
                <CommandEmpty>No option found.</CommandEmpty>
                <CommandGroup className="max-h-64 overflow-auto">
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      onSelect={() => {
                        onChange(
                          value.includes(option.value)
                            ? value.filter((item) => item !== option.value)
                            : [...value, option.value]
                        );
                        setOpen(true);
                      }}
                    >
                      <RxCheck
                        className={cn(
                          "mr-2 h-4 w-4",
                          value.includes(option.value)
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {option.label}
                    </CommandItem>
                  ))}
                  {!isExactMatch && (
                    <CommandItem
                      onSelect={() => {
                        props.onCreateOption?.(search);
                        setSearch("");
                      }}
                      value={search?.replace(/"/g, '\\"').trim() || ""}
                      className="cursor-pointer"
                    >
                      <span>Create</span>
                      <span className="ml-1 font-bold">{search || label}</span>
                    </CommandItem>
                  )}
                </CommandGroup>
              </ScrollArea>
            </Command>
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
    <Badge key={item} onClick={() => onUnselect(item)} variant="secondary">
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
