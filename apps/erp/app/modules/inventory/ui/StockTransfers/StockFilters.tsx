// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The table Filter / ActiveFilters for a list that is not a Table. Filters
// are component state so they never reload the page and lose its lines.

import {
  Button,
  Checkbox,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactElement } from "react";
import { useState } from "react";
import { LuListFilter, LuX } from "react-icons/lu";

export type StockFilterOption = {
  value: string;
  label: string;
  helper?: string;
};

export type StockFilterDefinition = {
  key: string;
  header: string;
  icon?: ReactElement;
  options: StockFilterOption[];
};

/** Selected option values per filter key; a key with no values is no filter. */
export type StockFilterValues = Record<string, string[]>;

export function toggleStockFilter(
  values: StockFilterValues,
  key: string,
  value: string
): StockFilterValues {
  const current = values[key] ?? [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  const { [key]: _removed, ...rest } = values;
  return next.length > 0 ? { ...rest, [key]: next } : rest;
}

export function removeStockFilter(
  values: StockFilterValues,
  key: string
): StockFilterValues {
  const { [key]: _removed, ...rest } = values;
  return rest;
}

function OptionList({
  heading,
  options,
  selected,
  onToggle
}: {
  heading?: string;
  options: StockFilterOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const { t } = useLingui();
  const [input, setInput] = useState("");
  return (
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
      <div className="max-h-[300px] overflow-y-auto">
        <CommandGroup heading={heading}>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={`${option.label} ${option.value}`.replace(/"/g, '\\"')}
              onSelect={() => {
                onToggle(option.value);
                setInput("");
              }}
            >
              <HStack spacing={2} className="w-full">
                <Checkbox
                  aria-hidden="true"
                  isChecked={selected.includes(option.value)}
                  tabIndex={-1}
                />
                <span className="flex-1 min-w-0 truncate">{option.label}</span>
                {option.helper && (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {option.helper}
                  </span>
                )}
              </HStack>
            </CommandItem>
          ))}
        </CommandGroup>
      </div>
    </Command>
  );
}

/** The dashed Filter button: pick a filter, then tick its options. */
export function StockFilter({
  filters,
  values,
  onChange
}: {
  filters: StockFilterDefinition[];
  values: StockFilterValues;
  onChange: (values: StockFilterValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const available = filters.filter((f) => !values[f.key]?.length);
  const active = filters.find((f) => f.key === activeKey) ?? null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setActiveKey(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          rightIcon={<LuListFilter />}
          className="!border-dashed border-border"
          isDisabled={available.length === 0}
        >
          <Trans>Filter</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-0">
        {active ? (
          <OptionList
            heading={active.header}
            options={active.options}
            selected={values[active.key] ?? []}
            onToggle={(value) =>
              onChange(toggleStockFilter(values, active.key, value))
            }
          />
        ) : (
          <Command>
            <CommandGroup>
              {available.map((filter) => (
                <CommandItem
                  key={filter.key}
                  value={filter.header}
                  onSelect={() => setActiveKey(filter.key)}
                  className="flex items-center gap-2"
                >
                  {filter.icon}
                  {filter.header}
                </CommandItem>
              ))}
            </CommandGroup>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One chip per applied filter, each editable in place, plus Clear filters. */
export function StockActiveFilters({
  filters,
  values,
  onChange
}: {
  filters: StockFilterDefinition[];
  values: StockFilterValues;
  onChange: (values: StockFilterValues) => void;
}) {
  const applied = filters.filter((f) => values[f.key]?.length);
  if (applied.length === 0) return null;

  return (
    <HStack spacing={2} className="flex-wrap">
      {applied.map((filter) => (
        <ActiveFilterChip
          key={filter.key}
          filter={filter}
          selected={values[filter.key] ?? []}
          onToggle={(value) =>
            onChange(toggleStockFilter(values, filter.key, value))
          }
          onRemove={() => onChange(removeStockFilter(values, filter.key))}
        />
      ))}
      <Button
        size="sm"
        variant="ghost"
        rightIcon={<LuX />}
        onClick={() => onChange({})}
      >
        <Trans>Clear filters</Trans>
      </Button>
    </HStack>
  );
}

function ActiveFilterChip({
  filter,
  selected,
  onToggle,
  onRemove
}: {
  filter: StockFilterDefinition;
  selected: string[];
  onToggle: (value: string) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const labels = selected.map(
    (value) => filter.options.find((o) => o.value === value)?.label ?? value
  );

  return (
    <HStack spacing={0}>
      <Button
        leftIcon={filter.icon ?? undefined}
        className="rounded-r-none"
        size="sm"
        variant="secondary"
      >
        {filter.header}
      </Button>
      <Button className="rounded-none border-l-0" size="sm" variant="secondary">
        {selected.length > 1 ? <Trans>is any of</Trans> : <Trans>is</Trans>}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            role="combobox"
            className="rounded-none border-l-0 max-w-[180px]"
            size="sm"
            variant="secondary"
          >
            <span className="truncate">
              {labels.length > 2
                ? t`${labels.length} selected`
                : labels.join(", ")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-0">
          <VStack spacing={0}>
            <OptionList
              options={filter.options}
              selected={selected}
              onToggle={onToggle}
            />
          </VStack>
        </PopoverContent>
      </Popover>
      <Button
        aria-label={t`Remove filter`}
        className="rounded-l-none border-l-0 px-1 w-6"
        size="sm"
        variant="secondary"
        onClick={onRemove}
      >
        <LuX />
      </Button>
    </HStack>
  );
}
