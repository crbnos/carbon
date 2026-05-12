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
  useMount
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import Filter from "./Filter";
import type { ColumnFilter } from "./types";
import { useFilters } from "./useFilters";

function getCurrentValues(value: string, isArray: boolean | undefined) {
  if (!value) return [];
  return isArray ? value.split(",") : [value];
}

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
  const { t, i18n } = useLingui();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
          : (fetcher.data.data?.map((d) => ({ label: d.name, value: d.id })) ??
              [])
      );

      setLoading(false);
    }
  }, [fetcher.data, filter.filter.type]);

  const makeLabel = (v: string) => {
    const [first, ...others] = v.split(",");
    if (others && others.length > 0) {
      return `${1 + others.length} ${
        filter.pluralHeader
          ? translate(filter.pluralHeader)
          : `${translate(filter.header)}s`
      }`;
    } else {
      if (filter.filter.type === "custom" && filter.filter.getLabel) {
        const node = filter.filter.getLabel(first);
        if (node == null) return first;
        return typeof node === "string"
          ? translate(node)
          : reactNodeToString(node);
      }
      const node = options.find((o) => o.value === v)?.label ?? "";
      return typeof node === "string"
        ? translate(node)
        : reactNodeToString(node);
    }
  };

  const translate = (text: string) => i18n._(text);

  return (
    <HStack spacing={0}>
      <Button
        leftIcon={filter.icon ?? undefined}
        className="rounded-r-none"
        size="sm"
        variant="secondary"
      >
        {translate(filter.header)}
      </Button>
      <Button className="rounded-none border-l-0" size="sm" variant="secondary">
        {operator === "eq" ? (
          <Trans>is</Trans>
        ) : operator === "in" || operator === "contains" ? (
          <Trans>is any of</Trans>
        ) : (
          <Trans>matches</Trans>
        )}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            className="rounded-none max-w-[200px]"
            role="combobox"
            variant="secondary"
            onClick={() => {
              setOpen(true);
            }}
            size="sm"
          >
            <span className="truncate">{makeLabel(value)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={
            filter.filter.type === "custom"
              ? "w-auto p-0"
              : "min-w-[200px] w-[--radix-popover-trigger-width] p-0"
          }
          sticky="always"
        >
          {filter.filter.type === "custom" ? (
            <div className="w-auto min-w-[280px] p-2">
              {filter.filter.render({
                values: getCurrentValues(value, filter.filter.isArray),
                toggle: (v) =>
                  toggleFilter(
                    filter.accessorKey,
                    v,
                    filter.filter.type === "custom"
                      ? filter.filter.isArray
                      : false
                  ),
                close: () => setOpen(false)
              })}
            </div>
          ) : (
            <Command>
              <CommandInput
                value={input}
                onValueChange={setInput}
                placeholder={t`Search...`}
                className="h-9"
              />
              <CommandEmpty>
                {loading ? (
                  <Trans>Loading...</Trans>
                ) : (
                  <Trans>No options found.</Trans>
                )}
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const isChecked = hasFilter(filter.accessorKey, option.value);
                  return (
                    <CommandItem
                      value={reactNodeToString(option.label).replace(
                        /"/g,
                        '\\"'
                      )}
                      key={option.value}
                      onSelect={() => {
                        toggleFilter(
                          filter.accessorKey,
                          option.value,
                          filter.filter.isArray
                        );
                        setInput("");
                      }}
                    >
                      <HStack spacing={2}>
                        <Checkbox id={option.value} isChecked={isChecked} />
                        <label htmlFor={option.value}>
                          {typeof option.label === "string"
                            ? translate(option.label)
                            : option.label}
                        </label>
                      </HStack>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </Command>
          )}
        </PopoverContent>
      </Popover>
      <Button
        aria-label={t`Remove filter`}
        className="rounded-l-none border-l-0 px-1 w-6"
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
