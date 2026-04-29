import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandTrigger,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import { LuCheck, LuSquareUser, LuUsers } from "react-icons/lu";

export type ScopeOption = {
  value: string;
  label: string;
  helper: "Type" | "Customer";
};

type ScopePickerProps = {
  value: string;
  options: ScopeOption[];
  onChange: (value: string) => void;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
};

const ScopeIcon = ({
  helper,
  className
}: {
  helper: ScopeOption["helper"];
  className?: string;
}) => {
  if (helper === "Type") return <LuUsers className={className} />;
  return <LuSquareUser className={className} />;
};

export function ScopePicker({
  value,
  options,
  onChange,
  size = "sm",
  placeholder
}: ScopePickerProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);

  const select = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const { types, customers, selected } = useMemo(() => {
    const types: ScopeOption[] = [];
    const customers: ScopeOption[] = [];
    let selected: ScopeOption | undefined;
    for (const o of options) {
      if (o.value === value) selected = o;
      if (o.helper === "Type") types.push(o);
      else if (o.helper === "Customer") customers.push(o);
    }
    return { types, customers, selected };
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <CommandTrigger
          asButton
          size={size}
          role="combobox"
          className={cn(
            "min-w-[220px] hover:!scale-100 focus-visible:!scale-100",
            !value && "text-muted-foreground"
          )}
        >
          {selected ? (
            <div className="flex items-center gap-2 truncate">
              <ScopeIcon
                helper={selected.helper}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{selected.label}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">
              {placeholder ?? t`Select scope`}
            </span>
          )}
        </CommandTrigger>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="min-w-[--radix-popover-trigger-width] w-[280px] p-0"
      >
        <Command>
          <CommandInput
            placeholder={t`Search customers and types...`}
            className="h-9"
          />
          <CommandList className="max-h-[320px]">
            {types.length > 0 && (
              <CommandGroup
                heading={
                  <GroupHeading icon={LuUsers} label={t`Customer Types`} />
                }
              >
                {types.map((opt) => (
                  <ScopeItem
                    key={opt.value}
                    option={opt}
                    selected={opt.value === value}
                    onSelect={select}
                  />
                ))}
              </CommandGroup>
            )}

            {types.length > 0 && customers.length > 0 && (
              <CommandSeparator className="my-1" />
            )}

            {customers.length > 0 && (
              <CommandGroup
                heading={
                  <GroupHeading icon={LuSquareUser} label={t`Customers`} />
                }
              >
                {customers.map((opt) => (
                  <ScopeItem
                    key={opt.value}
                    option={opt}
                    selected={opt.value === value}
                    onSelect={select}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function GroupHeading({
  icon: Icon,
  label
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function ScopeItem({
  option,
  selected,
  onSelect
}: {
  option: ScopeOption;
  selected: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <CommandItem
      value={`${option.label} ${option.helper} ${option.value}`}
      onSelect={() => onSelect(option.value)}
    >
      <span className="flex-1 truncate">{option.label}</span>
      <LuCheck
        className={cn("ml-2 size-4", selected ? "opacity-100" : "opacity-0")}
      />
    </CommandItem>
  );
}
