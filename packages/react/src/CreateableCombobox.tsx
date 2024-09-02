import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useState } from "react";
import { MdClose } from "react-icons/md";
import { RxCheck } from "react-icons/rx";
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
import { ScrollArea } from "./ScrollArea";
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

    return (
      <HStack spacing={1}>
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
          <PopoverContent className="min-w-[200px] w-[--radix-popover-trigger-width] p-0">
            <Command>
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search..."
                className="h-9"
              />
              <ScrollArea className="overflow-auto max-h-96">
                <CommandGroup>
                  {options.map((option) => {
                    const isSelected = !!selected?.includes(option.value);
                    return (
                      <CommandItem
                        value={
                          typeof option.label === "string"
                            ? option.label.replace(/"/g, '\\"') +
                              option.helper?.replace(/"/g, '\\"')
                            : undefined
                        }
                        key={option.value}
                        onSelect={() => {
                          if (!isSelected) onChange?.(option.value);
                          setOpen(false);
                        }}
                      >
                        {option.helper ? (
                          <div className="flex flex-col">
                            <p>{option.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {option.helper}
                            </p>
                          </div>
                        ) : (
                          option.label
                        )}
                        <RxCheck
                          className={cn(
                            "ml-auto h-4 w-4",
                            isSelected || option.value === value
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    );
                  })}
                  {!isExactMatch && (
                    <CommandItem
                      onSelect={() => {
                        props.onCreateOption?.(search);
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
