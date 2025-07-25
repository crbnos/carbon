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
  reactNodeToString,
  useMount,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { LuX } from "react-icons/lu";
import Filter from "./Filter";
import type { ColumnFilter } from "./types";
import { useFilters } from "./useFilters";

type ActiveFiltersProps = {
  filters: ColumnFilter[];
};

const ActiveFilters = ({ filters }: ActiveFiltersProps) => {
  const { urlFiltersParams } = useFilters();
  return (
    <HStack spacing={2}>
      {urlFiltersParams.map((f) => {
        const [key, operator, value] = f.split(":");
        const columnFilter = filters.find((f) => f.accessorKey === key);
        if (!columnFilter) return null;

        return (
          <ActiveFilter
            key={key}
            filter={columnFilter}
            operator={operator}
            value={value}
          />
        );
      })}
      {urlFiltersParams.length > 0 && (
        <Filter filters={filters} trigger="icon" />
      )}
    </HStack>
  );
};

type ActiveFilterProps = {
  filter: ColumnFilter;
  operator: string;
  value: string;
};

const ActiveFilter = ({ filter, operator, value }: ActiveFilterProps) => {
  const { hasFilter, removeKey, toggleFilter } = useFilters();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState(
    filter.filter.type === "static" ? filter.filter.options : []
  );

  useEffect(() => {
    if (filter.filter.type === "static") {
      setOptions(filter.filter.options);
    }
  }, [filter.filter]);

  useEffect(() => {
    if (!open) {
      setInput("");
    }
  }, [open]);

  const fetcher = useFetcher<PostgrestResponse<{ id: string; name: string }>>();

  useMount(() => {
    if (filter.filter.type === "fetcher") {
      setLoading(true);
      fetcher.load(filter.filter.endpoint);
    }
  });

  useEffect(() => {
    if (
      filter.filter.type === "fetcher" &&
      fetcher.data !== null &&
      typeof fetcher.data === "object" &&
      "data" in fetcher.data
    ) {
      setOptions(
        filter.filter.transform
          ? filter.filter.transform(fetcher.data.data)
          : fetcher.data.data?.map((d) => ({ label: d.name, value: d.id })) ??
              []
      );

      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, filter.filter.type]);

  const makeLabel = (v: string) => {
    const [, ...others] = v.split(",");
    if (others && others.length > 0) {
      return `${1 + others.length} ${
        filter.pluralHeader ? filter.pluralHeader : filter.header + "s"
      }`;
    } else {
      const node = options.find((o) => o.value === v)?.label ?? "";
      return typeof node === "string" ? node : reactNodeToString(node);
    }
  };

  return (
    <HStack spacing={0}>
      <Button
        leftIcon={filter.icon ?? undefined}
        className="rounded-r-none before:rounded-r-none"
        size="sm"
        variant="secondary"
      >
        {filter.header}
      </Button>
      <Button
        className="rounded-none before:rounded-none border-l-0"
        size="sm"
        variant="secondary"
      >
        {operator === "eq" ? "is" : operator === "in" ? "is any of" : "matches"}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            className="rounded-none before:rounded-none"
            role="combobox"
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
            size="sm"
          >
            {makeLabel(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="min-w-[200px] w-[--radix-popover-trigger-width] p-0"
          sticky="always"
        >
          <Command>
            <CommandInput
              value={input}
              onValueChange={setInput}
              placeholder="Search..."
              className="h-9"
            />
            <CommandEmpty>
              {loading ? "Loading..." : "No options found."}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isChecked = hasFilter(filter.accessorKey, option.value);
                return (
                  <CommandItem
                    value={reactNodeToString(option.label).replace(/"/g, '\\"')}
                    key={option.value}
                    onSelect={() => {
                      toggleFilter(
                        filter.accessorKey,
                        option.value,
                        filter.filter.isArray
                      );
                      setOpen(false);
                    }}
                  >
                    <HStack spacing={2}>
                      <Checkbox id={option.value} isChecked={isChecked} />
                      <label htmlFor={option.value}>{option.label}</label>
                    </HStack>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        aria-label="Remove filter"
        className="rounded-l-none before:rounded-l-none border-l-0 px-1 w-6"
        size="sm"
        variant="secondary"
        onClick={() => {
          removeKey(filter.accessorKey);
        }}
      >
        <LuX />
      </Button>
    </HStack>
  );
};

export default ActiveFilters;
