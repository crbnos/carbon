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
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { Row, Table } from "@tanstack/react-table";
import type { Range } from "@tanstack/react-virtual";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { BottomBar } from "~/components/Layout/Mobile/ChromeSlots";
import { useSetAppBarOverride } from "~/components/Layout/Mobile/useAppBarOverride";
import { useUrlParams } from "~/hooks";
import type { fieldMappings } from "~/modules/shared/imports.models";
import type { InfiniteRows } from "../../types";
import { findScrollParent, useInfiniteScroll } from "../../useInfiniteScroll";
import { useVirtualRows } from "../../useVirtualRows";
import type { DownloadProps } from "../Download";
import type { ColumnFilter } from "../Filter/types";
import { InfiniteStatus } from "../InfiniteStatus";
import { RowLimitNote } from "../RowLimitNote";
import { CompactEmpty, CompactLoading, CompactNoResults } from "./CompactEmpty";
import { CompactRow } from "./CompactRow";
import { CompactToolbar } from "./CompactToolbar";
import { resolveSlots } from "./resolveSlots";

// Used until a row is measured: a 3-line list row.
const ESTIMATED_ROW_HEIGHT = 72;
// Used until a group header is measured.
const ESTIMATED_GROUP_HEIGHT = 30;
const OVERSCAN = 10;
// The view height the server and the first client render assume, before
// the scroll element is measured. Without it those renders would draw no rows.
const INITIAL_VIEW_HEIGHT = 900;

// A page's phone list scrolls with the app shell's `<main>`; a list in a
// drawer or a modal scrolls with that. It is the nearest ancestor that can
// scroll and has content past its edge; `<main>` when none has yet.
function findListScrollParent(element: HTMLElement): HTMLElement | null {
  return (
    findScrollParent(element, { withOverflow: true }) ??
    document.querySelector<HTMLElement>("main")
  );
}

// One virtual item: a group header (its own item, so it can stay sticky
// while its rows scroll under it) or a row with its expanded content.
type ListEntry<T> =
  | { kind: "group"; key: string; rows: T[] }
  | { kind: "row"; key: string; row: Row<T> };

export type CompactListProps<T> = {
  table: Table<T>;
  titleBadge?: ReactNode;
  count: number;
  /** False while `count` is an estimate (`useExactCount`). */
  countIsExact: boolean;
  title?: string;
  tableName?: string;
  filters: ColumnFilter[];
  sortKeyToLabel: Record<string, string>;
  withSearch: boolean;
  withSort: boolean;
  withPagination: boolean;
  /** The infinite-scroll state, when the list loads more rows on scroll. */
  infinite?: InfiniteRows<T>;
  /** A single-load list that read `SINGLE_LOAD_LIMIT` rows (`<Table isTruncated>`). */
  isTruncated?: boolean;
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
  /** The "Select all matching" bar, shown above the rows while selecting. */
  selectAllBar?: ReactNode;
  /** Set while every matching row is selected: the list's count. */
  allMatchingCount?: number;
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
  countIsExact,
  title,
  tableName,
  filters,
  sortKeyToLabel,
  withSearch,
  withSort,
  withPagination,
  infinite,
  isTruncated = false,
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
  selectAllBar,
  allMatchingCount,
  renderExpandedRow,
  canExpandRow,
  groupStarts,
  groupHeader,
  totals,
  titleBadge
}: CompactListProps<T>) {
  const { t } = useLingui();
  const numberFormatter = useNumberFormatter();
  const [, setParams] = useUrlParams();
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

  /* Selection mode */
  const [selecting, setSelecting] = useState(false);
  const selectedRows = selecting
    ? table.getSelectedRowModel().flatRows.map((row) => row.original)
    : [];
  const selectionLabel =
    allMatchingCount !== undefined
      ? t`All matching rows selected`
      : t`${selectedRows.length} selected`;
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
            title: selectionLabel,
            trailing: (
              <Button variant="ghost" size="lg" onClick={exitSelection}>
                <Trans>Cancel</Trans>
              </Button>
            )
          }
        : null,
    [selecting, selectionLabel]
  );
  useSetAppBarOverride(override);

  /* Expandable rows */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /* Row virtualization on the list's scroll element (`<main>` on a page) */
  const entries = useMemo(() => {
    const list: ListEntry<T>[] = [];
    for (const row of rows) {
      const groupRows = groupHeader ? groupStarts.get(row.id) : undefined;
      if (groupRows) {
        list.push({ kind: "group", key: `group-${row.id}`, rows: groupRows });
      }
      list.push({ kind: "row", key: row.id, row });
    }
    return list;
  }, [rows, groupStarts, groupHeader]);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  // The list starts below the toolbar, inside the scrolled content.
  const [listOffset, setListOffset] = useState(0);
  // The scroll element is found again when the layout changes: a list that
  // grows past its drawer's edge starts to scroll with the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list mounts with the first row
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const scroller = findListScrollParent(root);
      setScrollElement(scroller);
      const list = listRef.current;
      if (!scroller || !list) return;
      setListOffset(
        list.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rows.length > 0]);

  // The group header above the first row in view stays rendered, so it can
  // stay stuck to the top while its rows scroll.
  const keepGroupHeader = useCallback(
    (range: Range) => {
      if (!groupHeader) return undefined;
      for (let index = range.startIndex; index >= 0; index--) {
        if (entries[index]?.kind === "group") return index;
      }
      return undefined;
    },
    [entries, groupHeader]
  );

  const { virtualizer, renderRows } = useVirtualRows({
    count: entries.length,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => entries[index]?.key ?? index,
    estimateSize: (index) =>
      entries[index]?.kind === "group"
        ? ESTIMATED_GROUP_HEIGHT
        : ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin: listOffset,
    keepIndex: keepGroupHeader,
    initialHeight: INITIAL_VIEW_HEIGHT
  });

  /* Infinite scroll: a sentinel after the rows, on the list's scroll
     element; it also remembers the scroll offset for Back. */
  const sentinelRef = useInfiniteScroll(infinite, { root: scrollElement });
  const isLoadingMore = infinite?.isLoadingMore ?? false;

  // "245 of 245 rows" in place of the pager: "about" until the exact count
  // arrives (`useExactCount`).
  // An estimate can be below the rows already loaded; it never shows less.
  const total = Math.max(count, rows.length);
  const loadedLabel = numberFormatter.format(rows.length);
  const loadedOfTotal = countIsExact
    ? t`${loadedLabel} of ${plural(total, { one: "# row", other: "# rows" })}`
    : t`${loadedLabel} of about ${plural(total, { one: "# row", other: "# rows" })}`;

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

  // Each entry's outer element is the one the virtualizer measures.
  const renderEntry = (entry: ListEntry<T>, index: number) => {
    const measured = {
      ref: virtualizer.measureElement,
      "data-index": index
    };
    if (entry.kind === "group") {
      return (
        <div
          key={entry.key}
          {...measured}
          className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-muted/90 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground backdrop-blur"
        >
          <div className="min-w-0 truncate normal-case tracking-normal">
            {groupHeader?.(entry.rows)}
          </div>
          <span className="shrink-0 tabular-nums">{entry.rows.length}</span>
        </div>
      );
    }
    const { row } = entry;
    const rowExpandable =
      !!renderExpandedRow && (!canExpandRow || canExpandRow(row.original));
    const isExpanded = rowExpandable && !!expanded[row.id];
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
      <div key={entry.key} {...measured}>
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
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className="flex min-h-full w-full min-w-0 flex-col bg-card"
    >
      {toolbar}
      {primaryActionRow}
      {totals.length > 0 ? (
        <CompactTotals
          totals={totals}
          format={(value) => numberFormatter.format(value)}
        />
      ) : null}
      {selecting ? selectAllBar : null}
      {/* An empty block stands in for each run of entries not rendered. A
          group header is the measured element itself, so `sticky` works
          against the list, not against a wrapper. */}
      <div ref={listRef} className="flex flex-col border-t border-border">
        {renderRows(
          (index) => renderEntry(entries[index]!, index),
          (key, height) => (
            <div key={key} aria-hidden style={{ height }} />
          )
        )}
      </div>
      <div ref={sentinelRef} aria-hidden />
      {isTruncated ? (
        <RowLimitNote className="px-4 py-4 text-center text-xs" />
      ) : null}

      {withPagination || infinite ? (
        <div className="flex flex-col items-center gap-2 px-4 py-4">
          <InfiniteStatus
            variant="list"
            isLoading={isLoadingMore}
            loadError={infinite?.loadError ?? false}
            onRetry={() => infinite?.retry()}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {loadedOfTotal}
          </span>
        </div>
      ) : null}

      {selecting && renderActions ? (
        <BottomBar>
          <div className="flex items-center gap-3 border-t border-border bg-card px-4 pt-2 pb-safe-4">
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {selectionLabel}
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
