import {
  Badge,
  BadgeCloseButton,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  multiSelectTriggerVariants,
} from "@carbon/react";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useId, useState } from "react";
import { RxCheck, RxMagnifyingGlass } from "react-icons/rx";

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
      <Popover>
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
                      onClick={() => handleUnselect(item)}
                    >
                      {options.find((option) => option.value === item)?.label}
                      <BadgeCloseButton
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
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
        <PopoverContent className="min-w-[200px] w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder="Search..." className="h-9" />
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
                      value.includes(option.value) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
);
MultiSelect.displayName = "MultiSelect";

export default MultiSelect;
