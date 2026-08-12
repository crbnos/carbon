import {
  Button,
  Checkbox,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  cn,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { LuListFilter } from "react-icons/lu";

export type PeopleFilterCategory = {
  key: string;
  /** already-translated label */
  header: string;
  icon?: ReactElement;
  options: { value: string; label: string }[];
  /** current selection; null = not filtered */
  value: string | null;
  /** false for location — it always has a value and can't be removed */
  clearable: boolean;
};

type PeopleFilterProps = {
  categories: PeopleFilterCategory[];
  onChange: (key: string, value: string | null) => void;
};

/**
 * The people page's filter control: a "Filter" button opening a command menu
 * (category → checkbox options). Active filters show as a dot on the button
 * rather than as pills — the toolbar stays a fixed width no matter how many
 * are applied — and each category's current value is listed inside the menu.
 */
export function PeopleFilter({ categories, onChange }: PeopleFilterProps) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setInput("");
      setActiveKey(null);
    }
  }, [open]);

  const active = categories.find((c) => c.key === activeKey) ?? null;
  // location always carries a value and can't be cleared, so it never counts
  // as "filtered" — only the narrowing filters do
  const appliedCount = categories.filter(
    (category) => category.clearable && category.value
  ).length;

  const labelFor = (category: PeopleFilterCategory) =>
    category.options.find((option) => option.value === category.value)?.label ??
    category.value;

  return (
    <HStack spacing={2}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            rightIcon={<LuListFilter />}
            role="combobox"
            variant="secondary"
            aria-label={
              appliedCount > 0 ? t`Filter (${appliedCount} applied)` : t`Filter`
            }
            className={cn(
              "relative",
              appliedCount === 0 && "!border-dashed border-border"
            )}
            onClick={() => setOpen(true)}
          >
            <Trans>Filter</Trans>
            {appliedCount > 0 && (
              <span className="absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-card" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="min-w-[220px] p-0">
          <Command>
            <CommandInput
              value={input}
              onValueChange={setInput}
              placeholder={t`Search...`}
              className="h-9"
            />
            <CommandEmpty>
              <Trans>No options found.</Trans>
            </CommandEmpty>
            {active === null ? (
              <CommandGroup>
                {categories.map((category) => (
                  <CommandItem
                    key={category.key}
                    value={category.header}
                    onSelect={() => {
                      setActiveKey(category.key);
                      setInput("");
                    }}
                    className="flex items-center gap-2"
                  >
                    {category.icon}
                    <span className="flex-1">{category.header}</span>
                    {/* the pills used to carry this — keep it visible here */}
                    {category.value && (
                      <span className="max-w-[120px] truncate text-xs text-muted-foreground">
                        {labelFor(category)}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
                <CommandGroup heading={active.header}>
                  {active.options.map((option) => {
                    const isChecked = active.value === option.value;
                    return (
                      <CommandItem
                        key={option.value}
                        value={option.label.replace(/"/g, '\\"')}
                        onSelect={() => {
                          onChange(
                            active.key,
                            isChecked && active.clearable ? null : option.value
                          );
                          setOpen(false);
                        }}
                      >
                        <HStack spacing={2}>
                          <Checkbox isChecked={isChecked} tabIndex={-1} />
                          <span>{option.label}</span>
                        </HStack>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </HStack>
  );
}
