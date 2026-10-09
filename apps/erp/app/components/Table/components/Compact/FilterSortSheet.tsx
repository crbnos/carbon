// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BottomSheet,
  BottomSheetBack,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
  Button,
  PrefetchLink,
  SheetSectionLabel,
  Spinner,
  sheetRowClassName
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuCheck,
  LuChevronRight
} from "react-icons/lu";
import { useFetcher, useLocation } from "react-router";
import { useUrlParams } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { ColumnFilter, Option } from "../Filter/types";
import { useFilters } from "../Filter/useFilters";
import { useSort } from "../Sort/useSort";

/** The options of one filter column: static, fetched, or a custom picker. */
function FilterOptions({
  filter,
  onClose
}: {
  filter: ColumnFilter;
  onClose: () => void;
}) {
  const { getFilter, hasFilter, setFilter, toggleFilter } = useFilters();
  const fetcher = useFetcher<PostgrestResponse<{ id: string; name: string }>>();
  const [options, setOptions] = useState<Option[]>(
    filter.filter.type === "static" ? filter.filter.options : []
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per filter
  useEffect(() => {
    if (filter.filter.type === "fetcher") fetcher.load(filter.filter.endpoint);
  }, [filter.accessorKey]);

  useEffect(() => {
    if (
      filter.filter.type === "fetcher" &&
      fetcher.data &&
      typeof fetcher.data === "object" &&
      "data" in fetcher.data
    ) {
      setOptions(
        filter.filter.transform
          ? filter.filter.transform(fetcher.data.data)
          : (fetcher.data.data?.map((d) => ({ label: d.name, value: d.id })) ??
              [])
      );
    }
  }, [fetcher.data, filter.filter]);

  if (filter.filter.type === "custom") {
    return (
      <div className="px-1">
        {filter.filter.render({
          values: getFilter(filter.accessorKey),
          toggle: (value) =>
            toggleFilter(
              filter.accessorKey,
              value,
              filter.filter.type === "custom" ? filter.filter.isArray : false
            ),
          close: onClose
        })}
      </div>
    );
  }

  if (fetcher.state !== "idle" && options.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  const isArray = "isArray" in filter.filter ? filter.filter.isArray : false;
  const isExclusive =
    filter.filter.type === "static" ? filter.filter.isExclusive : false;

  return (
    <div className="flex flex-col">
      {options.map((option) => {
        const checked = hasFilter(filter.accessorKey, option.value);
        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is radio or checkbox
          <button
            key={option.value}
            type="button"
            role={isExclusive ? "radio" : "checkbox"}
            aria-checked={checked}
            className={sheetRowClassName}
            onClick={() =>
              isExclusive && !checked
                ? setFilter(filter.accessorKey, option.value)
                : toggleFilter(filter.accessorKey, option.value, isArray)
            }
          >
            <span className="min-w-0 flex-1 truncate">
              {option.label}
              {option.helperText ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {option.helperText}
                </span>
              ) : null}
            </span>
            {checked ? (
              <LuCheck className="size-5 shrink-0 text-primary" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filter & sort for a compact list: saved views, then sort, then one
 * row per filter column that drills into its options. Every choice applies at
 * once through the same URL params as desktop, so the count stays live.
 */
export function FilterSortSheet({
  open,
  onOpenChange,
  filters,
  sortKeyToLabel,
  tableName,
  count
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ColumnFilter[];
  sortKeyToLabel: Record<string, string>;
  tableName?: string;
  count: number;
}) {
  const { t } = useLingui();
  const location = useLocation();
  const [, setParams] = useUrlParams();
  const { savedViews, view } = useSavedViews();
  const { clearFilters, getFilter, hasFilters } = useFilters();
  const [activeFilter, setActiveFilter] = useState<ColumnFilter | null>(null);

  useEffect(() => {
    if (!open) setActiveFilter(null);
  }, [open]);

  const views = useMemo(
    () =>
      tableName
        ? savedViews
            .filter((v) => v.table === tableName)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        : [],
    [savedViews, tableName]
  );

  const { sorts, isSorted, toggleSortByAscending, toggleSortByDirection } =
    useSort();
  const sortEntries = Object.entries(sortKeyToLabel);

  // Like desktop, a new sort leads and the existing ones stay as tiebreakers.
  const setSort = (key: string) => {
    if (isSorted(key)) toggleSortByDirection(key);
    else toggleSortByAscending(key);
  };

  const reset = () => {
    clearFilters();
    setParams({ sort: undefined, filter: undefined });
  };

  const viewHref = (v: (typeof views)[number]) =>
    `${location.pathname}?view=${v.id}${
      v.filters?.length ? `&filter=${v.filters.join("&filter=")}` : ""
    }${v.sorts?.length ? `&sort=${v.sorts.join("&sort=")}` : ""}`;

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent>
        <BottomSheetHeader>
          {activeFilter ? (
            <BottomSheetBack onClick={() => setActiveFilter(null)} />
          ) : null}
          <BottomSheetTitle>
            {activeFilter ? activeFilter.header : <Trans>Filter & sort</Trans>}
          </BottomSheetTitle>
        </BottomSheetHeader>
        <BottomSheetBody className="px-2">
          {activeFilter ? (
            <FilterOptions
              filter={activeFilter}
              onClose={() => setActiveFilter(null)}
            />
          ) : (
            <>
              {views.length > 0 ? (
                <>
                  <SheetSectionLabel>
                    <Trans>Saved views</Trans>
                  </SheetSectionLabel>
                  {views.map((v) => (
                    <PrefetchLink
                      key={v.id}
                      to={viewHref(v)}
                      className={sheetRowClassName}
                      onClick={() => onOpenChange(false)}
                    >
                      <span className="min-w-0 flex-1 truncate">{v.name}</span>
                      {view === v.id ? (
                        <LuCheck className="size-5 shrink-0 text-primary" />
                      ) : null}
                    </PrefetchLink>
                  ))}
                </>
              ) : null}
              {sortEntries.length > 0 ? (
                <>
                  <SheetSectionLabel>
                    <Trans>Sort</Trans>
                  </SheetSectionLabel>
                  {sortEntries.map(([key, label]) => {
                    const direction = isSorted(key);
                    const isActive = direction !== null;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="checkbox"
                        aria-checked={isActive}
                        className={sheetRowClassName}
                        onClick={() => setSort(key)}
                      >
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {isActive ? (
                          <span className="flex items-center gap-1 text-sm text-primary">
                            {direction === -1 ? (
                              <LuArrowDown className="size-4" />
                            ) : (
                              <LuArrowUp className="size-4" />
                            )}
                            {direction === -1 ? t`Descending` : t`Ascending`}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </>
              ) : null}
              {filters.length > 0 ? (
                <>
                  <SheetSectionLabel>
                    <Trans>Filters</Trans>
                  </SheetSectionLabel>
                  {filters.map((filter) => {
                    const applied = getFilter(filter.accessorKey);
                    return (
                      <button
                        key={filter.accessorKey}
                        type="button"
                        className={sheetRowClassName}
                        onClick={() => setActiveFilter(filter)}
                      >
                        {filter.icon ? (
                          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-5">
                            {filter.icon}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {filter.header}
                        </span>
                        {applied.length > 0 ? (
                          <span className="shrink-0 rounded-full bg-primary px-2 text-xs font-medium leading-5 text-primary-foreground tabular-nums">
                            {applied.length}
                          </span>
                        ) : null}
                        <LuChevronRight className="size-5 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </>
              ) : null}
            </>
          )}
        </BottomSheetBody>
        <BottomSheetFooter>
          <Button
            variant="secondary"
            size="lg"
            onClick={reset}
            isDisabled={!hasFilters && sorts.length === 0}
          >
            <Trans>Reset</Trans>
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => onOpenChange(false)}
          >
            {t`Show ${count} results`}
          </Button>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  );
}
