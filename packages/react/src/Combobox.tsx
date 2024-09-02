import type { ComponentPropsWithoutRef } from "react";
import { forwardRef, useState } from "react";
import { MdClose } from "react-icons/md";
import { RxCheck } from "react-icons/rx";
import {
  Command,
  CommandEmpty,
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
  isReadOnly?: boolean;
  placeholder?: string;
  onChange?: (selected: string) => void;
};

const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      size,
      value,
      options,
      isClearable,
      isReadOnly,
      placeholder,
      onChange,
      ...props
    },
    ref
  ) => {
    const [open, setOpen] = useState(false);
    return (
      <HStack spacing={1}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <CommandTrigger
              size={size}
              role="combobox"
              className={cn("min-w-[160px]", !value && "text-muted-foreground")}
              ref={ref}
              onClick={() => setOpen(true)}
              {...props}
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
              <CommandInput placeholder="Search..." className="h-9" />
              <ScrollArea className="overflow-auto max-h-96">
                <CommandEmpty>No option found.</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      value={
                        typeof option.label === "string"
                          ? option.label + option.helper
                          : undefined
                      }
                      key={option.value}
                      onSelect={() => {
                        onChange?.(option.value);
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
                          option.value === value ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
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
Combobox.displayName = "Combobox";

export { Combobox };
