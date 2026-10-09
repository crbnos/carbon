// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  cn,
  DropdownMenu,
  DropdownMenuTrigger,
  Menu
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { Table } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { BottomBar } from "~/components/Layout/Mobile/ChromeSlots";
import { useSetAppBarOverride } from "~/components/Layout/Mobile/useAppBarOverride";
import { useUrlParams } from "~/hooks";
import type { fieldMappings } from "~/modules/shared/imports.models";
import { MAX_PAGE_SIZE, PAGE_SIZES } from "~/utils/pagination";
import type { DownloadProps } from "../Download";
import type { ColumnFilter } from "../Filter/types";
import type { usePagination } from "../Pagination";
import { CompactEmpty, CompactLoading, CompactNoResults } from "./CompactEmpty";
import { CompactRow } from "./CompactRow";
import { CompactToolbar } from "./CompactToolbar";
import { resolveSlots } from "./resolveSlots";

const PAGE = 25;

export type CompactListProps<T> = {
  table: Table<T>;
  titleBadge?: ReactNode;
  count: number;
  title?: string;
  tableName?: string;
  filters: ColumnFilter[];
  sortKeyToLabel: Record<string, string>;
  withSearch: boolean;
  withSort: boolean;
  withPagination: boolean;
  pagination: ReturnType<typeof usePagination>;
  withSelectableRows: boolean;
  headerActions?: ReactNode;
  primaryAction?: ReactNode;
  /** Extra items first in the toolbar ⋯. */
  mobileMenuItems?: ReactNode;
  emptyState?: ReactNode;
  isLoading: boolean;
  isTableEmpty: boolean;
  hasFilters: boolean;
  clearFilters: () => void;
  csvExport?: DownloadProps;
  importCSV?: { table: keyof typeof fieldMappings; label: string }[];
  renderContextMenu?: (row: T) => JSX.Element | null;
  renderActions?: (selectedRows: T[]) => ReactNode;
  renderExpandedRow?: (row: T) => ReactNode;
  canExpandRow?: (row: T) => boolean;
  groupStarts: Map<string, T[]>;
  groupHeader?: (rows: T[]) => ReactNode;
  totals: {
    id: string;
    label: ReactNode;
    value: number;
    formatter?: (value: number) => string;
  }[];
};

/**
 * A table's compact (phone) presentation: the same TanStack instance, rows,
 * filters, sort, selection and actions as the desktop grid, rendered as a
 * list of 3-line rows.
 */
export function CompactList<T>({
  table,
  count,
  title,
  tableName,
  filters,
  sortKeyToLabel,
  withSearch,
  withSort,
  withPagination,
  pagination,
  withSelectableRows,
  headerActions,
  primaryAction,
  mobileMenuItems,
  emptyState,
  isLoading,
  isTableEmpty,
  hasFilters,
  clearFilters,
  csvExport,
  importCSV,
  renderContextMenu,
  renderActions,
  renderExpandedRow,
  canExpandRow,
  groupStarts,
  groupHeader,
  totals,
  titleBadge
}: CompactListProps<T>) {
  const { t } = useLingui();
  const numberFormatter = useNumberFormatter();
  const [params, setParams] = useUrlParams();
  const rows = table.getRowModel().rows;

  // Only the columns desktop shows (a hidden column never fills a slot).
  const columnVisibility = table.getState().columnVisibility;
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibility changes re-resolve the slots
  const slots = useMemo(
    () =>
      resolveSlots(
        table
          .getAllLeafColumns()
          .filter((c) => c.getIsVisible() && !c.columnDef.meta?.exportOnly),
        tableName ?? title
      ),
    [table, tableName, title, columnVisibility]
  );

  /* Paging: reveal 25 loaded rows at a time. On the first page, raise `limit`
     up to the largest page size; past it (or from a deep link with an
     offset), step through pages like desktop. */
  const [visible, setVisible] = useState(PAGE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new result set starts over
  useEffect(() => {
    setVisible(PAGE);
  }, [
    params.get("search"),
    params.getAll("filter").join(),
    params.getAll("sort").join(),
    params.get("view"),
    params.get("offset")
  ]);

  const shown = Math.min(visible, rows.length);
  const offset = withPagination ? pagination.offset : 0;
  const total = withPagination ? pagination.count : rows.length;
  const allShown = shown >= rows.length;
  const hasNextPage = withPagination && pagination.canNextPage;
  const nextLimit =
    hasNextPage && offset === 0 && pagination.pageSize < MAX_PAGE_SIZE
      ? PAGE_SIZES.find((size) => size > pagination.pageSize)
      : undefined;
  const canLoadMore = !allShown || nextLimit !== undefined;
  const loadMore = () => {
    setVisible((v) => v + PAGE);
    if (allShown && nextLimit !== undefined) {
      setParams({ limit: String(nextLimit), offset: null });
    }
  };
  const firstShown = offset + 1;
  const lastShown = offset + shown;
  const showPageNav =
    allShown &&
    nextLimit === undefined &&
    (hasNextPage || (withPagination && pagination.canPreviousPage));

  /* Selection mode */
  const [selecting, setSelecting] = useState(false);
  const selectedRows = selecting
    ? table.getSelectedRowModel().flatRows.map((row) => row.original)
    : [];
  const exitSelection = () => {
    table.resetRowSelection();
    setSelecting(false);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt when the selection or its count changes
  const override = useMemo(
    () =>
      selecting
        ? {
            kind: "selection" as const,
            title: t`${selectedRows.length} selected`,
            trailing: (
              <Button variant="ghost" size="lg" onClick={exitSelection}>
                <Trans>Cancel</Trans>
              </Button>
            )
          }
        : null,
    [selecting, selectedRows.length]
  );
  useSetAppBarOverride(override);

  /* Expandable rows */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toolbar = (
    <CompactToolbar
      titleBadge={titleBadge}
      title={title}
      tableName={tableName}
      count={count}
      filters={filters}
      sortKeyToLabel={sortKeyToLabel}
      withSearch={withSearch}
      withSort={withSort}
      headerActions={headerActions}
      csvExport={csvExport}
      importCSV={importCSV}
      menuItems={mobileMenuItems}
      onSelect={
        withSelectableRows && rows.length > 0 && !selecting
          ? () => setSelecting(true)
          : undefined
      }
      // Like desktop: a genuinely empty list has no toolbar.
      hideControls={isTableEmpty}
    />
  );

  // A New button portals itself to the app bar "+"; any other primary control
  // (a picker, a split button) stays here. Hidden when nothing renders in place.
  const primaryActionRow = primaryAction ? (
    <div className="flex flex-wrap items-center gap-2 bg-card px-4 pb-2 [&:not(:has(button,a,input))]:hidden [&>*]:max-w-full [&>div]:flex-wrap [&_button]:h-11">
      {primaryAction}
    </div>
  ) : null;

  if (rows.length === 0 || !slots) {
    return (
      <div className="flex min-h-full w-full min-w-0 flex-col bg-card">
        {toolbar}
        {!isLoading && !emptyState && !hasFilters && isTableEmpty
          ? null
          : primaryActionRow}
        {isLoading ? (
          <CompactLoading />
        ) : emptyState ? (
          <div className="flex flex-col items-center gap-4 px-4 py-12">
            {emptyState}
          </div>
        ) : hasFilters ? (
          <CompactNoResults onClear={clearFilters} />
        ) : isTableEmpty ? (
          <CompactEmpty title={title} primaryAction={primaryAction} />
        ) : (
          <CompactNoResults onClear={() => setParams({ search: undefined })} />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-full w-full min-w-0 flex-col bg-card">
      {toolbar}
      {primaryActionRow}
      {totals.length > 0 ? (
        <CompactTotals
          totals={totals}
          format={(value) => numberFormatter.format(value)}
        />
      ) : null}
      <div className="flex flex-col border-t border-border">
        {rows.slice(0, shown).map((row) => {
          const rowExpandable =
            !!renderExpandedRow &&
            (!canExpandRow || canExpandRow(row.original));
          const isExpanded = rowExpandable && !!expanded[row.id];
          const groupRows = groupStarts.get(row.id);
          const content = (
            <CompactRow
              row={row}
              slots={slots}
              selection={
                selecting
                  ? {
                      selected: row.getIsSelected(),
                      onToggle: () => row.toggleSelected()
                    }
                  : undefined
              }
              expansion={
                rowExpandable
                  ? {
                      expanded: isExpanded,
                      onToggle: () =>
                        setExpanded((prev) => ({
                          ...prev,
                          [row.id]: !prev[row.id]
                        }))
                    }
                  : undefined
              }
            />
          );
          return (
            <Fragment key={row.id}>
              {groupRows && groupHeader ? (
                <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-muted/90 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground backdrop-blur">
                  <div className="min-w-0 truncate normal-case tracking-normal">
                    {groupHeader(groupRows)}
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {groupRows.length}
                  </span>
                </div>
              ) : null}
              {renderContextMenu && !selecting ? (
                <Menu type="context">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div>{content}</div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      {renderContextMenu(row.original)}
                    </ContextMenuContent>
                  </ContextMenu>
                </Menu>
              ) : (
                content
              )}
              {isExpanded && renderExpandedRow ? (
                <div className="overflow-x-auto border-b border-border bg-muted/20">
                  {renderExpandedRow(row.original)}
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>

      {offset > 0 || shown < total ? (
        <div className="flex flex-col items-center gap-2 px-4 py-4">
          {canLoadMore ? (
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={loadMore}
              isLoading={isLoading}
            >
              <Trans>Load more</Trans>
            </Button>
          ) : null}
          {showPageNav ? (
            <div className="flex w-full gap-2">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                isDisabled={!pagination.canPreviousPage}
                onClick={pagination.previousPage}
              >
                <Trans>Previous page</Trans>
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                isDisabled={!hasNextPage}
                isLoading={isLoading}
                onClick={pagination.nextPage}
              >
                <Trans>Next page</Trans>
              </Button>
            </div>
          ) : null}
          <span className="text-xs text-muted-foreground tabular-nums">
            {t`Showing ${firstShown}–${lastShown} of ${total}`}
          </span>
        </div>
      ) : null}

      {selecting && renderActions ? (
        <BottomBar>
          <div className="flex items-center gap-3 border-t border-border bg-card px-4 pt-2 pb-safe-4">
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {t`${selectedRows.length} selected`}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="primary"
                  size="lg"
                  isDisabled={selectedRows.length === 0}
                >
                  <Trans>Actions</Trans>
                </Button>
              </DropdownMenuTrigger>
              {renderActions(selectedRows)}
            </DropdownMenu>
          </div>
        </BottomBar>
      ) : null}
    </div>
  );
}

/**
 * The table's footer totals, above the rows: collapsed to its first total so
 * the list starts right under it, expanded on a tap.
 */
function CompactTotals({
  totals,
  format
}: {
  totals: CompactListProps<unknown>["totals"];
  format: (value: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const formatTotal = (total: (typeof totals)[number]) =>
    total.formatter ? total.formatter(total.value) : format(total.value);
  const first = totals[0]!;

  return (
    <div className="mx-4 mb-2 rounded-xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="shrink-0 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
          <Trans>Totals</Trans>
        </span>
        {open ? (
          <span className="flex-1" />
        ) : (
          <span className="flex min-w-0 flex-1 items-center justify-end gap-2 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">
              {first.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {formatTotal(first)}
            </span>
          </span>
        )}
        <LuChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-border px-3 py-1">
          {totals.map((total) => (
            <div
              key={total.id}
              className="flex min-h-9 items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {total.label}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatTotal(total)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
