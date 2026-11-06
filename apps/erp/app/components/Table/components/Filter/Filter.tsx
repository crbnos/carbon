// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { ComponentPropsWithoutRef } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { IoMdAdd } from "react-icons/io";
import { LuListFilter, LuX } from "react-icons/lu";
import { useFetcher } from "react-router";
import DateRangeFilter from "./DateRangeFilter";
import type { ColumnFilter, Option } from "./types";
import { useFilters } from "./useFilters";

export type FilterProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onChange"
> & {
  filters: ColumnFilter[];
  trigger?: "button" | "icon";
};

const Filter = forwardRef<HTMLButtonElement, FilterProps>(
  ({ filters, trigger = "button", ...props }, ref) => {
    const { t } = useLingui();
    const {
      clearFilters,
      getFilter,
      hasFilter,
      hasFilters,
      hasFilterKey,
      setFilter,
      toggleFilter
    } = useFilters();

    const [open, setOpen] = useState(false);
    // The button in place when the popover closes: its trigger, or "Clear
    // Filters" once a filter is set, which replaces the trigger.
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    // Set when the popover closes from a click or focus outside it: focus then
    // stays where the user put it.
    const closedFromOutside = useRef(false);
    const setButtonRef = useCallback(
      (node: HTMLButtonElement | null) => {
        buttonRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState<ColumnFilter | null>(null);
    const [activeOptions, setActiveOptions] = useState<Option[]>([]);

    // reset the state when the filter
    useEffect(() => {
      if (!open) {
        setInput("");
        setActiveOptions([]);
        setActiveFilter(null);
      }
    }, [open]);

    const fetcher =
      useFetcher<PostgrestResponse<{ id: string; name: string }>>();

    useEffect(() => {
      if (
        activeFilter?.filter.type === "fetcher" &&
        fetcher.data !== null &&
        typeof fetcher.data === "object" &&
        "data" in fetcher.data
      ) {
        setActiveOptions(
          activeFilter.filter.transform
            ? activeFilter.filter.transform(fetcher.data.data)
            : (fetcher.data.data?.map((d) => ({
                label: d.name,
                value: d.id
              })) ?? [])
        );

        setLoading(false);
      }
    }, [fetcher.data, activeFilter]);

    const columnFilters = useMemo(
      () =>
        filters.map((f) => ({
          value: f.accessorKey,
          label: f.header,
          icon: f.icon
        })),
      [filters]
    );

    const availableFilters = useMemo(
      () => columnFilters.filter((column) => !hasFilterKey(column.value)),
      [columnFilters, hasFilterKey]
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const activate = useCallback((filter: ColumnFilter) => {
      setInput("");
      setActiveFilter(filter);
      if (filter.filter.type === "static") {
        setActiveOptions(filter.filter.options);
      } else if (filter.filter.type === "fetcher") {
        setLoading(true);
        fetcher.load(filter.filter.endpoint);
      } else {
        setActiveOptions([]);
      }
    }, []);

    const updateActiveOptions = useCallback(
      (value: string) => {
        const accessorKey = value.split(":")?.[1] ?? "";
        const filter = filters.find(
          (f) => f.accessorKey.toLowerCase() === accessorKey.toLowerCase()
        );
        if (!filter)
          throw new Error(`Filter not found for accessorKey: ${accessorKey}`);
        activate(filter);
      },
      [filters, activate]
    );

    // Skip the one-item column picker when only one filter is available.
    useEffect(() => {
      if (!open || activeFilter !== null) return;
      if (availableFilters.length !== 1) return;
      const filter = filters.find(
        (f) => f.accessorKey === availableFilters[0].value
      );
      if (filter) activate(filter);
    }, [open, activeFilter, availableFilters, filters, activate]);

    const activeFilterName = activeFilter?.header;

    return hasFilters && !open && trigger !== "icon" ? (
      <HStack>
        <Button
          rightIcon={<LuX />}
          ref={setButtonRef}
          variant="secondary"
          onClick={clearFilters}
          className={"!border-dashed border-border"}
          {...props}
        >
          <Trans>Clear Filters</Trans>
        </Button>
      </HStack>
    ) : (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {trigger === "icon" ? (
            <Button
              ref={setButtonRef}
              aria-label={t`Add filter`}
              className="px-1 w-6"
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(true);
              }}
            >
              <IoMdAdd />
            </Button>
          ) : (
            <Button
              rightIcon={<LuListFilter />}
              role="combobox"
              ref={setButtonRef}
              variant="secondary"
              onClick={() => {
                setOpen(true);
              }}
              className={"!border-dashed border-border"}
              {...props}
            >
              <Trans>Filter</Trans>
            </Button>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="min-w-[var(--radix-popover-trigger-width)] p-0"
          onInteractOutside={() => {
            closedFromOutside.current = true;
          }}
          onCloseAutoFocus={(event) => {
            const fromOutside = closedFromOutside.current;
            closedFromOutside.current = false;
            const focused = document.activeElement;
            if (fromOutside && focused && focused !== document.body) return;
            // Radix returns focus to the trigger it opened from, which may
            // have been replaced by "Clear Filters" meanwhile.
            event.preventDefault();
            buttonRef.current?.focus();
          }}
        >
          {activeFilter?.filter.type === "custom" ? (
            <div className="w-auto min-w-[280px] p-2">
              {activeFilter.filter.render({
                values: getFilter(activeFilter.accessorKey),
                toggle: (value) =>
                  toggleFilter(
                    activeFilter.accessorKey,
                    value,
                    activeFilter.filter.type === "custom"
                      ? activeFilter.filter.isArray
                      : false
                  ),
                close: () => setOpen(false)
              })}
            </div>
          ) : activeFilter?.filter.type === "dateRange" ? (
            <div className="w-auto min-w-[280px] p-2">
              <DateRangeFilter accessorKey={activeFilter.accessorKey} />
            </div>
          ) : (
            <Command>
              <CommandInput
                value={input}
                onValueChange={setInput}
                placeholder={t`Search...`}
                aria-label={
                  activeFilterName
                    ? t`Search ${activeFilterName} values`
                    : t`Search filters`
                }
                className="h-9"
              />
              <CommandEmpty>
                {loading ? (
                  <Trans>Loading...</Trans>
                ) : (
                  <Trans>No available filters</Trans>
                )}
              </CommandEmpty>
              {activeFilter === null ? (
                <CommandGroup>
                  {availableFilters.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.label}:${option.value}`.replace(
                        /"/g,
                        '\\"'
                      )}
                      onSelect={updateActiveOptions}
                      className="flex items-center gap-2"
                    >
                      {option.icon}
                      {option.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <div className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
                  <CommandGroup heading={activeFilter.header}>
                    {activeOptions.map((option) => {
                      const isChecked = hasFilter(
                        activeFilter.accessorKey,
                        option.value
                      );
                      return (
                        <CommandItem
                          value={reactNodeToString(option.label).replace(
                            /"/g,
                            '\\"'
                          )}
                          key={option.value}
                          onSelect={() => {
                            if (
                              activeFilter.filter.type === "static" &&
                              activeFilter.filter.isExclusive &&
                              !isChecked
                            ) {
                              // Radio semantics: replace the previous option
                              setFilter(activeFilter.accessorKey, option.value);
                            } else {
                              toggleFilter(
                                activeFilter.accessorKey,
                                option.value,
                                activeFilter.filter.isArray
                              );
                            }
                            setInput("");
                          }}
                        >
                          <HStack spacing={2}>
                            <Checkbox
                              aria-hidden
                              isChecked={isChecked}
                              tabIndex={-1}
                            />
                            <VStack spacing={0}>
                              <span>{option.label}</span>
                              {option.helperText && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {option.helperText}
                                </p>
                              )}
                            </VStack>
                          </HStack>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </div>
              )}
            </Command>
          )}
        </PopoverContent>
      </Popover>
    );
  }
);
Filter.displayName = "Filter";

export default Filter;
