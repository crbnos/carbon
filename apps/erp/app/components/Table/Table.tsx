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
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Menu,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useEscape,
  useIsomorphicLayoutEffect,
  useMount,
  useOutsideClick,
  useViewport,
  VStack
} from "@carbon/react";
import { clamp } from "@carbon/utils";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type {
  Column,
  ColumnDef,
  ColumnOrderState,
  ColumnPinningState,
  OnChangeFn,
  Table as ReactTable,
  RowData,
  RowSelectionState
} from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuArrowUpDown,
  LuHash,
  LuSigma,
  LuTrendingUpDown,
  LuTriangleAlert
} from "react-icons/lu";
import { useNavigation } from "react-router";
import { useSpinDelay } from "spin-delay";
import type {
  EditableTableCellComponent,
  Position
} from "~/components/Editable";
import { useUrlParams } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { fieldMappings } from "~/modules/shared/imports.models";
import { Row, TableHeader, useSort } from "./components";
import { CompactList } from "./components/Compact";
import { CompactToolbar } from "./components/Compact/CompactToolbar";
import type { ColumnFilter } from "./components/Filter/types";
import { useFilters } from "./components/Filter/useFilters";
import { InfiniteStatus } from "./components/InfiniteStatus";
import { RowLimitNote } from "./components/RowLimitNote";
import {
  SelectAllMatchingBar,
  useSelectAllMatching
} from "./components/SelectAllMatching";
import {
  getActionColumn,
  getExpandColumn,
  getRowSelectionColumn
} from "./components/SyntheticColumns";
import { TableLoadingSkeleton } from "./components/TableLoadingSkeleton";
import { readRowId } from "./infiniteRowsStore";
import { applyRowEdits, pruneRowEdits, type RowEdits, tick } from "./rowEdits";
import type {
  BulkActionScope,
  ColumnSizeMap,
  InfiniteOptions,
  InfiniteRows
} from "./types";
import { useExactCount } from "./useExactCount";
import { useGrowOnlyColumnWidths } from "./useGrowOnlyColumnWidths";
import { useInfiniteRows } from "./useInfiniteRows";
import { useInfiniteScroll } from "./useInfiniteScroll";
import { useVirtualRows } from "./useVirtualRows";
import {
  buildColumnMaps,
  getAccessorKey,
  hasUniqueRowIds,
  isServerSortable
} from "./utils";

// A column's held width, as a header `min-width`. A body cell is at most
// `30dvw` wide (`Cell.tsx`), so no column needs more: the cap keeps one odd
// reading from pushing the rest of the table out of view.
const minWidthStyle = (width: number | undefined) =>
  width === undefined ? undefined : `min(${width}px, 30dvw)`;

// Used until a row is measured: a body cell is `h-11` plus the row's border.
const ESTIMATED_ROW_HEIGHT = 45;
// Used until the header is measured: every `Th` is `h-11`.
const ESTIMATED_HEADER_HEIGHT = 44;
// The rows rendered beyond each edge of the view.
const OVERSCAN = 10;
// The view height the server and the first client render assume, before the
// scroll element is measured. Without it those renders would draw no rows.
const INITIAL_VIEW_HEIGHT = 1200;
// The columns the Table adds itself. They never hold the footer label.
const SYNTHETIC_COLUMNS = new Set(["Expand", "Select", "Actions"]);

interface TableProps<T extends object> {
  columns: ColumnDef<T>[];
  count?: number;
  compact?: boolean;
  data: T[];
  defaultColumnOrder?: string[];
  defaultColumnPinning?: ColumnPinningState;
  defaultColumnVisibility?: Record<string, boolean>;
  editableComponents?: Record<string, EditableTableCellComponent<T>>;
  importCSV?: {
    table: keyof typeof fieldMappings;
    label: string;
  }[];
  primaryAction?: ReactNode;
  // Optional override for the "no rows" state. When provided and the table is
  // empty (and not loading), this is rendered instead of the default
  // "No results found" / "No data exists" blocks. Use it when the generic
  // filtered empty state would be misleading — e.g. a table pre-filtered to a
  // parent entity that simply has no child records yet.
  emptyState?: ReactNode;
  // Optional controls rendered in the toolbar row next to the search/filter
  // (e.g. quick filter toggles that write their own `filter` URL params).
  headerActions?: ReactNode;
  // Set when the caller narrows `data` itself (local search/filter state the
  // table can't see in the URL). Without it a caller-filtered-to-zero table
  // looks "genuinely empty" and the toolbar — including the caller's own search
  // box in `headerActions` — is hidden, leaving no way to undo the filter.
  isFiltered?: boolean;
  table?: string;
  title?: string;
  // Optional node rendered immediately after the title (e.g. a status badge).
  titleBadge?: ReactNode;
  withInlineEditing?: boolean;
  // When true, the table starts in edit mode and the Edit/Lock toggle is hidden
  // (editing is always on — e.g. a Draft document that is inherently editable).
  forceEditMode?: boolean;
  withPagination?: boolean;
  withSavedView?: boolean;
  withSearch?: boolean;
  withSelectableRows?: boolean;
  // Forwarded to TableHeader — hide the app-sidebar toggle when this Table is
  // rendered inside a drawer or modal.
  withSidebarTrigger?: boolean;
  // Forwarded to TableHeader — embedded tables (wizards/drawers) can turn off
  // the column picker and CSV download; both default on.
  withColumnOrdering?: boolean;
  withCsvExport?: boolean;
  withSimpleSorting?: boolean;
  sort?: ReactNode;
  getRowId?: (originalRow: T, index: number) => string;
  // Infinite scroll: the loader pages with a cursor (`toPage`), and the table
  // loads the next page from the same loader as the user scrolls.
  infinite?: InfiniteOptions;
  // Controlled infinite scroll: the parent's `useInfiniteRows` result, in
  // place of `infinite` (see `InfiniteOptions`). `data` is its page 1.
  infiniteRows?: InfiniteRows<T>;
  // A single-load list (no `infinite`) whose loader read `SINGLE_LOAD_LIMIT`
  // rows: more may match, so the table says it shows only the first ones.
  isTruncated?: boolean;
  // Replaces the note under a truncated list, for one whose rows are not what
  // its loader read (Receiving reads lines and shows orders).
  rowLimitNote?: ReactNode;
  // Optional per-row class (e.g. to highlight rows that failed validation).
  getRowClassName?: (originalRow: T) => string | undefined;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  onSelectedRowsChange?: (selectedRows: T[]) => void;
  // `scope.allMatching` is set when the user selected every matching row of a
  // list past 1,000 rows (only `selectedRows` are loaded then).
  renderActions?: (selectedRows: T[], scope?: BulkActionScope) => ReactNode;
  renderContextMenu?: (row: T) => JSX.Element | null;
  renderExpandedRow?: (row: T) => ReactNode;
  // Pin an expanded row's content (`sticky left-0`) to the scroll container's
  // visible width, so on a table several viewports wide (the 48-week planning
  // grids) it stays in view instead of sitting at the far left of the row and
  // scrolling away with it. Off by default: it changes how every other
  // expanded row scrolls.
  pinExpandedRows?: boolean;
  // When `renderExpandedRow` is set, gates which rows can expand (show a chevron
  // + toggle). Defaults to all rows. Use it so only parents with children get an
  // affordance, like a tree's `hasChildren`.
  canExpandRow?: (row: T) => boolean;
  // While set, every expandable row starts expanded: a list's search, so the
  // matches in the expanded rows show, or `true` for always. A row the user
  // toggles keeps their choice until the value changes.
  expandRowsFor?: string | true | null;
  // Renders a full-width header row above each run of consecutive rows that
  // share a key (e.g. a report grouped by date). Grouping follows `data`'s
  // order, so the caller sorts by the key; `header` receives the run's rows.
  // The header is as wide as the visible table and stays in view when it
  // scrolls sideways, so it can put actions at its right edge.
  groupRowsBy?: {
    key: (row: T) => string;
    header: (rows: T[]) => ReactNode;
  };
  // Phones: "list" (default) renders 3-line rows from the columns'
  // `meta.mobile` priorities; "table" keeps the grid, scrolling sideways with
  // a sticky first column (inline-editing grids, comparison tables).
  mobileLayout?: "list" | "table";
  /** Phones: extra items first in the list toolbar ⋯ (e.g. Recalculate). */
  mobileMenuItems?: ReactNode;
}

type AggregateFunction = "sum" | "average" | "min" | "max" | "median" | "count";

interface AggregateFunctionOption {
  value: AggregateFunction;
  label: string;
  icon: ReactElement;
}

const aggregateFunctions: AggregateFunctionOption[] = [
  { value: "sum", label: "Sum", icon: <LuSigma /> },
  { value: "average", label: "Average", icon: <LuTrendingUpDown /> },
  { value: "min", label: "Min", icon: <LuArrowDown /> },
  { value: "max", label: "Max", icon: <LuArrowUp /> },
  { value: "median", label: "Median", icon: <LuArrowUpDown /> },
  { value: "count", label: "Count", icon: <LuHash /> }
];

function numeric(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function aggregateForCol<TData extends RowData>(
  table: ReactTable<TData>,
  columnId: string,
  aggregateFn: AggregateFunction = "sum"
): number {
  const rows = table.getFilteredRowModel().rows;

  const values = rows
    .map((r) => numeric(r.getValue(columnId)))
    .filter((v): v is number => v !== null);

  if (!values.length) return 0;

  switch (aggregateFn) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "average":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "median": {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }
    case "count":
      return values.length;
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

interface AggregateSelectorProps {
  value: number;
  aggregateFunction: AggregateFunction;
  onAggregateFunctionChange: (fn: AggregateFunction) => void;
  formatter?: (
    val: number | bigint | `${number}` | "Infinity" | "-Infinity" | "+Infinity"
  ) => string;
}

const AggregateSelector = ({
  value,
  aggregateFunction,
  onAggregateFunctionChange,
  formatter
}: AggregateSelectorProps) => {
  const numberFormatter = useNumberFormatter();
  const currentFunction = aggregateFunctions.find(
    (fn) => fn.value === aggregateFunction
  );

  const formattedValue =
    aggregateFunction === "count" || !formatter
      ? numberFormatter.format(value)
      : formatter(value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className="flex justify-start items-center gap-2 cursor-pointer">
          <span className="text-muted-foreground">{currentFunction?.icon}</span>
          <span className="font-medium">{formattedValue}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={aggregateFunction}>
          {aggregateFunctions.map((fn) => (
            <DropdownMenuRadioItem
              key={fn.value}
              value={fn.value}
              onClick={() => onAggregateFunctionChange(fn.value)}
            >
              <DropdownMenuIcon icon={fn.icon} />
              {fn.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const Table = <T extends object>({
  data,
  columns,
  compact = false,
  count: loaderCount = 0,
  defaultColumnOrder,
  defaultColumnPinning,
  defaultColumnVisibility,
  editableComponents,
  importCSV,
  primaryAction,
  emptyState,
  headerActions,
  isFiltered = false,
  table: tableName,
  title,
  titleBadge,
  withInlineEditing = false,
  forceEditMode = false,
  withPagination = true,
  withSavedView = false,
  withSearch = true,
  withSelectableRows = false,
  withSidebarTrigger = true,
  withColumnOrdering = true,
  withCsvExport = true,
  withSimpleSorting = true,
  sort,
  getRowId,
  infinite,
  infiniteRows: controlledInfiniteRows,
  isTruncated = false,
  rowLimitNote,
  getRowClassName,
  rowSelection: controlledRowSelection,
  onRowSelectionChange,
  onSelectedRowsChange,
  renderActions,
  renderContextMenu,
  renderExpandedRow,
  pinExpandedRows = false,
  canExpandRow,
  expandRowsFor,
  groupRowsBy,
  mobileLayout = "list",
  mobileMenuItems
}: TableProps<T>) => {
  const { t } = useLingui();
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // Visible width of the scroll container, for `pinExpandedRows` and the
  // `groupRowsBy` header rows: both stay in view as the table scrolls sideways.
  // Measured before paint, so a group header never shows at its content width
  // first and then jumps.
  const [containerWidth, setContainerWidth] = useState(0);
  const measureContainer = pinExpandedRows || !!groupRowsBy;
  useIsomorphicLayoutEffect(() => {
    const el = tableContainerRef.current;
    if (!measureContainer || !el || typeof ResizeObserver === "undefined") {
      return;
    }
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureContainer]);

  const { currentView, view } = useSavedViews();

  /* Expandable Rows (keyed by row id): the rows the user toggled, over
     `expandRowsFor` */
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const expandRowsByDefault = !!expandRowsFor;
  const [expandedRowsFor, setExpandedRowsFor] = useState(expandRowsFor);
  if (expandedRowsFor !== expandRowsFor) {
    setExpandedRowsFor(expandRowsFor);
    setExpandedRows({});
  }

  const isRowExpanded = useCallback(
    (rowId: string) => expandedRows[rowId] ?? expandRowsByDefault,
    [expandedRows, expandRowsByDefault]
  );

  const toggleRowExpanded = useCallback(
    (rowId: string) => {
      setExpandedRows((prev) => ({
        ...prev,
        [rowId]: !(prev[rowId] ?? expandRowsByDefault)
      }));
    },
    [expandRowsByDefault]
  );

  /* Rows: the loader's rows, then the pages loaded on scroll (`infinite`).
     With `infiniteRows` the parent runs the hook, and this one stays off. */
  const ownInfiniteRows = useInfiniteRows<T>({
    initialRows: data,
    infinite: controlledInfiniteRows ? undefined : infinite,
    getRowId: getRowId ? (row) => getRowId(row, -1) : undefined
  });
  const infiniteRows = controlledInfiniteRows ?? ownInfiniteRows;
  const { hasMore, isLoadingMore, loadError, retry, syncedAt } = infiniteRows;
  const sourceRows = infiniteRows.rows;
  const infiniteOptions = infiniteRows.options;
  const isInfinite = !!infiniteOptions;
  const listKey = infiniteOptions?.listKey;
  const { count, isExact: countIsExact } = useExactCount({
    count: loaderCount,
    infinite: infiniteOptions
  });

  // Key rows by their id when every row has a unique one, so a selection, an
  // expanded row or an edit stays on its row when pages are appended.
  const idColumn = infiniteOptions?.idColumn ?? "id";
  const rowIdsAreUnique = useMemo(
    () => hasUniqueRowIds(sourceRows, idColumn),
    [sourceRows, idColumn]
  );
  const resolvedGetRowId = useMemo(
    () =>
      getRowId ??
      (rowIdsAreUnique ? (row: T) => readRowId(row, idColumn)! : undefined),
    [getRowId, rowIdsAreUnique, idColumn]
  );
  const rowKey = useCallback(
    (row: T, index: number) =>
      resolvedGetRowId ? resolvedGetRowId(row, index) : String(index),
    [resolvedGetRowId]
  );

  /* Optimistic inline edits by row id, laid over the rows until a load that
     started after the edit, or a row that already holds it. */
  const [edits, setEdits] = useState<RowEdits>({});
  const tableData = useMemo(
    () => applyRowEdits(sourceRows, edits, rowKey, syncedAt),
    [sourceRows, edits, rowKey, syncedAt]
  );
  useEffect(() => {
    setEdits((current) => pruneRowEdits(current, sourceRows, rowKey, syncedAt));
  }, [sourceRows, rowKey, syncedAt]);

  /* Selectable Rows, with "Select all matching" */
  const selection = useSelectAllMatching({
    rows: tableData,
    getRowId: rowKey,
    isSelectable: withSelectableRows,
    hasStableRowIds: !!resolvedGetRowId,
    rowSelection: controlledRowSelection,
    onRowSelectionChange,
    infiniteRows,
    count,
    canSelectAll:
      withSelectableRows && typeof renderActions === "function" && isInfinite
  });
  const { rowSelection, allMatching } = selection;

  // Anchor row (by id) for shift-click range selection.
  const selectionAnchorRef = useRef<string | null>(null);

  /* Column Visibility */
  const [columnVisibility, setColumnVisibility] = useState(
    currentView?.columnVisibility ?? defaultColumnVisibility ?? {}
  );

  /* Column Ordering */
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    currentView?.columnOrder ?? defaultColumnOrder ?? []
  );

  // The synthetic columns first (left) and last (right), then the caller's
  // default pins.
  const getDefaultColumnPinning = (): ColumnPinningState => ({
    left: [
      ...(renderExpandedRow ? ["Expand"] : []),
      ...(withSelectableRows ? ["Select"] : []),
      ...(Array.isArray(defaultColumnPinning?.left)
        ? defaultColumnPinning.left
        : [])
    ],
    right: [
      ...(renderContextMenu ? ["Actions"] : []),
      ...(Array.isArray(defaultColumnPinning?.right)
        ? defaultColumnPinning.right
        : [])
    ]
  });
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>(
    () => currentView?.columnPinning ?? getDefaultColumnPinning()
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (currentView) {
      setColumnVisibility(currentView.columnVisibility);
      setColumnOrder(currentView.columnOrder);
      setColumnPinning(currentView.columnPinning);
    } else {
      setColumnVisibility(defaultColumnVisibility ?? {});
      setColumnOrder(defaultColumnOrder ?? []);
      setColumnPinning(getDefaultColumnPinning());
    }
  }, [view]);

  /* Sorting */
  const { isSorted, toggleSortByAscending, toggleSortByDescending } = useSort();

  const {
    accessors: columnAccessors,
    exportValues,
    sortKeyToLabel,
    exportOnlyColumns
  } = useMemo(() => buildColumnMaps(columns), [columns]);

  // Export-only columns must never render in the grid. Force them hidden in the
  // table state without mutating the stored columnVisibility (so saved-view
  // state stays correct). The CSV side reads the same `exportOnlyColumns` list
  // (passed to Download) to include them regardless of visibility — both halves
  // are driven by the one `meta.exportOnly` flag, not by visibility coincidence.
  const effectiveColumnVisibility = useMemo(() => {
    if (!exportOnlyColumns.length) return columnVisibility;
    const next = { ...columnVisibility };
    for (const id of exportOnlyColumns) next[id] = false;
    return next;
  }, [columnVisibility, exportOnlyColumns]);

  const internalColumns = useMemo(() => {
    let result: ColumnDef<T>[] = [];
    if (renderExpandedRow) {
      result.push(
        ...getExpandColumn<T>(
          isRowExpanded,
          toggleRowExpanded,
          {
            expand: t`Expand`,
            expandRow: t`Expand row`,
            collapseRow: t`Collapse row`
          },
          canExpandRow
        )
      );
    }
    if (withSelectableRows) {
      result.push(...getRowSelectionColumn<T>(selectionAnchorRef));
    }
    result.push(...columns);
    if (renderContextMenu) {
      result.push(...getActionColumn<T>(renderContextMenu, t`Actions`));
    }
    return result;
  }, [
    columns,
    renderContextMenu,
    withSelectableRows,
    renderExpandedRow,
    canExpandRow,
    isRowExpanded,
    toggleRowExpanded,
    t
  ]);

  const table = useReactTable({
    data: tableData,
    columns: internalColumns,
    state: {
      columnVisibility: effectiveColumnVisibility,
      columnOrder,
      columnPinning,
      rowSelection
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onColumnPinningChange: setColumnPinning,
    onRowSelectionChange: selection.onRowSelectionChange,
    getRowId: resolvedGetRowId,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      // These are not part of the standard API, but are accessible via table.options.meta
      editableComponents,
      updateData: (rowIndex, updates) => {
        const row = tableData[rowIndex];
        if (!row) return;
        const id = rowKey(row, rowIndex);
        setEdits((current) => {
          const previous = current[id];
          const values =
            previous && previous.at >= syncedAt ? previous.values : {};
          return {
            ...current,
            [id]: { values: { ...values, ...updates }, at: tick() }
          };
        });
      }
    }
  });

  const selectedRows = withSelectableRows
    ? table.getSelectedRowModel().flatRows.map((row) => row.original)
    : [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (typeof onSelectedRowsChange === "function") {
      onSelectedRowsChange(selectedRows);
    }
  }, [rowSelection, onSelectedRowsChange]);

  const selectAllBar = (
    <SelectAllMatchingBar
      selectedCount={selectedRows.length}
      count={count}
      countIsExact={countIsExact}
      {...selection.bar}
    />
  );

  // The actions see the selection's scope; past 1,000 rows `selectedRows`
  // holds only the loaded rows.
  const scopedRenderActions = useMemo(
    () =>
      renderActions
        ? (rows: T[]) =>
            renderActions(rows, { allMatching: allMatching ?? undefined })
        : undefined,
    [renderActions, allMatching]
  );

  const [editMode, setEditMode] = useState(forceEditMode);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedCell, setSelectedCell] = useState<Position>(null);

  // forceEditMode follows the document's state (e.g. Reopen flips a Pending
  // count back to Draft via revalidation, without remounting the table) — and
  // the Edit/Lock toggle is hidden while it's set, so a stale editMode would
  // strand the table with no way to recover. Keep them in sync.
  useEffect(() => {
    setEditMode(forceEditMode);
  }, [forceEditMode]);

  /* Aggregate Functions */
  const [columnAggregates, setColumnAggregates] = useState<
    Record<string, AggregateFunction>
  >({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const focusOnSelectedCell = useCallback(() => {
    if (selectedCell == null) return;
    const cell = tableContainerRef.current?.querySelector(
      `[data-row="${selectedCell.row}"][data-column="${selectedCell.column}"]`
    ) as HTMLDivElement;
    if (cell) cell.focus();
  }, [selectedCell, tableContainerRef]);

  useEscape(() => {
    setIsEditing(false);
    focusOnSelectedCell();
  });

  const { isPhone } = useViewport();
  // Clicking outside the table clears the selected cell (and ends any edit). A
  // cell's editable input commits on blur first, so the value is saved before
  // this runs. Portaled dropdowns (e.g. a cell's combobox popover, or its
  // bottom sheet on phones) render outside the container but belong to an
  // active edit — ignore clicks in them.
  useOutsideClick({
    ref: tableContainerRef,
    enabled: selectedCell != null,
    handler: (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          isPhone
            ? "[data-radix-popper-content-wrapper],[role=dialog]"
            : "[data-radix-popper-content-wrapper]"
        )
      )
        return;
      setIsEditing(false);
      setSelectedCell(null);
    }
  });

  const onSelectedCellChange = useCallback(
    (position: Position) => {
      if (
        selectedCell == null ||
        position == null ||
        selectedCell.row !== position?.row ||
        selectedCell.column !== position.column
      )
        setSelectedCell(position);
    },
    [selectedCell]
  );

  const isColumnEditable = useCallback(
    (selectedColumn: number) => {
      if (!withInlineEditing) return false;

      const tableColumns = [
        ...table.getLeftVisibleLeafColumns(),
        ...table.getCenterVisibleLeafColumns()
      ];

      const column =
        tableColumns[withSelectableRows ? selectedColumn + 1 : selectedColumn];
      if (!column) return false;

      const accessorKey = getAccessorKey(column.columnDef);
      return (
        accessorKey && editableComponents && accessorKey in editableComponents
      );
    },
    [table, editableComponents, withInlineEditing, withSelectableRows]
  );

  const onCellClick = useCallback(
    (row: number, column: number) => {
      // ignore row select checkbox column
      if (column === -1) return;
      // Editable cells enter edit mode on a single click (the editable input
      // then auto-focuses and selects its text), instead of select-then-click.
      if (isColumnEditable(column)) {
        onSelectedCellChange({ row, column });
        setIsEditing(true);
        return;
      }
      setIsEditing(false);
      onSelectedCellChange({ row, column });
    },
    [isColumnEditable, onSelectedCellChange]
  );

  const onCellUpdate = useCallback(
    (rowIndex: number) => (updates: Record<string, unknown>) =>
      table.options.meta?.updateData
        ? table.options.meta?.updateData(rowIndex, updates)
        : undefined,
    [table]
  );

  // Excel-like keyboard model, attached in the CAPTURE phase so navigation
  // keys are handled before the cell editor sees them (react-aria's
  // NumberField swallows Enter without propagation and steps the value on
  // ArrowUp/Down — capture lets the table own those keys while editing).
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selectedCell) return;
      // Don't hijack keys aimed at a portaled overlay (a cell editor's
      // combobox/date popover, a row context menu) — those own their keys.
      if (event.nativeEvent.isComposing) return;
      // A dialog the table itself sits in (a grid in a modal) is not an
      // overlay over it: only skip one that does not contain the table.
      const target = event.target as HTMLElement | null;
      const overlay = target?.closest(
        "[data-radix-popper-content-wrapper],[role=menu],[role=listbox],[role=dialog]"
      );
      if (overlay && !overlay.contains(event.currentTarget)) return;

      const { code, shiftKey } = event;

      const commandCodes: {
        [key: string]: [number, number];
      } = {
        Tab: [0, 1],
        Enter: [1, 0]
      };

      const navigationCodes: {
        [key: string]: [number, number];
      } = {
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0]
      };

      const lastRow = table.getRowModel().rows.length - 1;
      const lastColumn =
        table.getVisibleLeafColumns().length - 1 - (withSelectableRows ? 1 : 0);

      const navigate = (
        delta: [number, number],
        tabWrap = false
      ): [number, number] => {
        const x0 = selectedCell?.column || 0;
        const y0 = selectedCell?.row || 0;

        let x1 = x0 + delta[1];
        let y1 = y0 + delta[0];

        if (tabWrap) {
          if (delta[1] > 0) {
            // wrap to the next row if we're on the last column
            if (x1 > lastColumn) {
              x1 = 0;
              y1 += 1;
            }
            // don't wrap to the next row if we're on the last row
            if (y1 > lastRow) {
              x1 = x0;
              y1 = y0;
            }
          } else {
            // reverse tab wrap
            if (x1 < 0) {
              x1 = lastColumn;
              y1 -= 1;
            }

            if (y1 < 0) {
              x1 = x0;
              y1 = y0;
            }
          }
        } else {
          x1 = clamp(x1, 0, lastColumn);
        }

        y1 = clamp(y1, 0, lastRow);

        return [x1, y1];
      };

      // Commit any in-flight edit before navigating away. Editors commit
      // their value on blur — without this, the navigation's preventDefault
      // keeps focus on the input until it unmounts and the blur never fires,
      // silently dropping the typed value.
      const commitActiveEdit = () => {
        if (
          isEditing &&
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body
        ) {
          document.activeElement.blur();
        }
      };

      if (code in commandCodes) {
        event.preventDefault();
        // Keep the key away from the editor entirely (react-aria would
        // otherwise run its own Enter commit on the input).
        if (isEditing) event.stopPropagation();

        if (
          !isEditing &&
          code === "Enter" &&
          !shiftKey &&
          isColumnEditable(selectedCell.column)
        ) {
          setIsEditing(true);
          return;
        }

        let direction = commandCodes[code];
        if (shiftKey) direction = [-direction[0], -direction[1]];
        const [x1, y1] = navigate(direction, code === "Tab");

        commitActiveEdit();

        setSelectedCell({
          row: y1,
          column: x1
        });
        if (isEditing) {
          setIsEditing(false);
        }
      } else if (code in navigationCodes) {
        event.preventDefault();
        // Excel-like: while editing, an arrow commits the edit and moves the
        // selection — it must not step the value or move the text cursor.
        if (isEditing) event.stopPropagation();
        const [x1, y1] = navigate(navigationCodes[code], code === "Tab");
        commitActiveEdit();
        setIsEditing(false);
        setSelectedCell({
          row: y1,
          column: x1
        });
        // any other key (besides shift) activates editing
        // if the column is editable and a cell is selected
      } else if (
        !["ShiftLeft", "ShiftRight"].includes(code) &&
        !isEditing &&
        selectedCell &&
        isColumnEditable(selectedCell.column)
      ) {
        setIsEditing(true);
      }
    },
    [
      isColumnEditable,
      isEditing,
      selectedCell,
      setSelectedCell,
      table,
      withSelectableRows
    ]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (selectedCell) setSelectedCell(null);
  }, [editMode]);

  useMount(() => {
    setColumnOrder(table.getAllLeafColumns().map((column) => column.id));
  });

  const filters = useMemo(
    () =>
      columns.reduce<ColumnFilter[]>((acc, column) => {
        const header =
          typeof column.header === "string"
            ? column.header
            : column.meta?.filterHeader;
        if (column.meta?.filter && header) {
          const filter: ColumnFilter = {
            accessorKey: getAccessorKey(column) ?? column.id!,
            header,
            pluralHeader: column.meta.pluralHeader,
            filter: column.meta.filter,
            icon: column.meta.icon
          };
          return [...acc, filter];
        }
        return acc;
      }, []),
    [columns]
  );

  const rows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns();

  // Row id → the rows of the group that row starts (only group starts appear).
  const groupStarts = useMemo(() => {
    const starts = new Map<string, T[]>();
    if (!groupRowsBy) return starts;
    let current: T[] = [];
    let previousKey: string | undefined;
    for (const row of rows) {
      const key = groupRowsBy.key(row.original);
      if (key !== previousKey) {
        current = [];
        starts.set(row.id, current);
        previousKey = key;
      }
      current.push(row.original);
    }
    return starts;
  }, [rows, groupRowsBy]);

  /* Row virtualization: only the rows in view (plus overscan) are in the DOM.
     One virtual item is one data row, with its group header and expanded row
     in the same `<tbody>`, so one measurement covers all three. */
  const isPhoneList = isPhone && mobileLayout === "list";
  const hasRows = rows.length > 0;
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [headerHeight, setHeaderHeight] = useState(ESTIMATED_HEADER_HEIGHT);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the header mounts with the first row
  useEffect(() => {
    const el = theadRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasRows, isPhoneList]);

  // The selected row stays rendered when it scrolls out of view: it holds the
  // keyboard focus and, mid-edit, the open editor. Dropping it would lose both.
  const selectedRowIndex = selectedCell?.row;
  const keepSelectedRow = useCallback(
    () => selectedRowIndex,
    [selectedRowIndex]
  );
  const { virtualizer: rowVirtualizer, renderRows: renderVirtualRows } =
    useVirtualRows({
      enabled: !isPhoneList,
      count: rows.length,
      getScrollElement: () => tableContainerRef.current,
      getItemKey: (index) => rows[index]?.id ?? index,
      estimateSize: () => ESTIMATED_ROW_HEIGHT,
      overscan: OVERSCAN,
      scrollMargin: headerHeight,
      // A row scrolled into view lands below the sticky header, not under it.
      scrollPaddingStart: headerHeight,
      keepIndex: keepSelectedRow,
      initialHeight: INITIAL_VIEW_HEIGHT
    });

  // Keyboard moves in edit mode can leave the view: follow the selected row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the selected row only
  useEffect(() => {
    if (!editMode || selectedRowIndex === undefined || isPhoneList) return;
    rowVirtualizer.scrollToIndex(selectedRowIndex, { align: "auto" });
  }, [editMode, selectedRowIndex]);

  /* Infinite scroll (a sentinel after the rows), the scroll offset for Back,
     and the top of a new list. */
  const sentinelRef = useInfiniteScroll(infiniteRows, {
    root: tableContainerRef,
    enabled: !isPhoneList
  });

  const tableRef = useRef<HTMLTableElement>(null);

  // Getter for the nested table wrapper element
  const getTableWrapperEl = useCallback(
    () => tableRef.current?.parentElement as HTMLDivElement | undefined,
    []
  );
  const getHeaderElSelector = (id: string) => `#header-${id}`;

  const columnMinWidths = useGrowOnlyColumnWidths({
    tableRef,
    containerRef: tableContainerRef,
    resetKey: `${visibleColumns.map((c) => c.id).join(",")}|${
      infiniteRows.resetKey
    }|${rows.length > 0}`,
    enabled: !isPhoneList
  });

  const pinnedColumnsKey = visibleColumns.reduce<string>(
    (acc, col) => (col.getIsPinned() ? `${acc}:${col.id}` : acc),
    ""
  );
  const [columnSizeMap, setColumnSizeMap] = useState<ColumnSizeMap>(new Map());

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    const calculateColumnWidths = () => {
      const tableWrapperEl = getTableWrapperEl();
      if (!tableWrapperEl) return;

      const columnWidths: ColumnSizeMap = new Map();
      let leftPinnedWidth = 0;

      // First pass - calculate widths
      table.getHeaderGroups().forEach(({ headers }) => {
        headers.forEach((header) => {
          if (header.id.includes(">>")) return;
          const headerEl = tableWrapperEl.querySelector(
            getHeaderElSelector(header.id)
          );
          const width = headerEl?.clientWidth ?? 0;

          if (header.column.getIsPinned() === "left") {
            columnWidths.set(header.id, {
              width,
              startX: leftPinnedWidth
            });
            leftPinnedWidth += width;
          } else {
            columnWidths.set(header.id, {
              width,
              startX: 0 // Will be calculated in second pass
            });
          }
        });
      });

      // Second pass - calculate non-pinned positions
      let currentX = leftPinnedWidth;
      table.getHeaderGroups().forEach(({ headers }) => {
        headers.forEach((header) => {
          if (!header.column.getIsPinned()) {
            columnWidths.set(header.id, {
              width: columnWidths.get(header.id)?.width ?? 0,
              startX: currentX
            });
            currentX += columnWidths.get(header.id)?.width ?? 0;
          }
        });
      });

      setColumnSizeMap(columnWidths);
    };

    // Initial calculation
    calculateColumnWidths();

    // Add resize observer to handle window/table size changes
    const tableWrapper = getTableWrapperEl();
    if (tableWrapper) {
      const resizeObserver = new ResizeObserver(() => {
        calculateColumnWidths();
      });
      resizeObserver.observe(tableWrapper);
      // Also observe the table itself: internal layout changes (e.g. tree
      // expansion adding rows/widening columns) resize the table without
      // resizing the wrapper, which would leave pinned offsets stale.
      if (tableRef.current) {
        resizeObserver.observe(tableRef.current);
      }
      return () => resizeObserver.disconnect();
    }
  }, [
    getTableWrapperEl,
    table,
    visibleColumns,
    pinnedColumnsKey,
    columnOrder,
    withSelectableRows
  ]);
  // const lastLeftPinnedColumn = table
  //   .getLeftVisibleLeafColumns()
  //   .findLast((c) => c.getIsPinned() === "left");

  // Horizontal scroll affordance: without it a pinned column simply truncates
  // the row and nothing signals that more columns exist. Track which edges have
  // content scrolled past them so pinned cells can cast a shadow over it.
  const [scrolledEdges, setScrolledEdges] = useState({
    left: false,
    right: false
  });

  // The extra deps are deliberate re-attach triggers rather than values read in
  // the body: `tableRef` is null on first mount (the table only renders once
  // there are rows), so the observer must be re-registered when the structure
  // changes, or the overflow is never detected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach triggers
  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;

    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      setScrolledEdges((prev) => {
        const next = {
          left: el.scrollLeft > 1,
          right: maxScroll > 1 && el.scrollLeft < maxScroll - 1
        };
        return prev.left === next.left && prev.right === next.right
          ? prev
          : next;
      });
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    // Observe the table as well as the container: rendering rows widens the
    // table without resizing its scroll parent, so observing only the parent
    // would never see the overflow appear.
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    if (tableRef.current) resizeObserver.observe(tableRef.current);
    return () => {
      el.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, [visibleColumns, columnOrder, pinnedColumnsKey]);

  // Primitive the memoized Row/Cell comparators can compare — see Cell.tsx.
  // `getPinnedStyles` is a fresh closure every render, so this has to encode
  // everything it can return: the scrolled edges that drive the shadow, and
  // each pinned column's sticky offset out of `columnSizeMap` (the resize
  // observer replaces that Map wholesale, so comparing the Map itself would
  // re-render every row on every observation).
  const pinnedStyleKey = `${scrolledEdges.left}:${scrolledEdges.right}|${visibleColumns
    .filter((col) => col.getIsPinned())
    .map((col) => `${col.id}@${columnSizeMap.get(col.id)?.startX ?? 0}`)
    .join(",")}`;

  const getPinnedStyles = (column: Column<T>): CSSProperties => {
    const isPinned = column.getIsPinned();
    if (!isPinned) return {};

    const pinnedPosition = columnSizeMap.get(column.id);
    const startX = pinnedPosition?.startX ?? 0;

    // Only shadow the side that actually has content hidden behind it.
    const castsShadow =
      isPinned === "left" ? scrolledEdges.left : scrolledEdges.right;

    return {
      position: "sticky",
      left: isPinned === "left" ? startX : undefined,
      right: isPinned === "right" ? 0 : undefined,
      zIndex: 2,
      // Negative spread keeps the shadow on the offset side only, so no
      // clip-path is needed to stop it leaking over neighbouring cells.
      boxShadow: castsShadow
        ? isPinned === "left"
          ? "8px 0 10px -6px hsl(var(--foreground) / 0.35)"
          : "-8px 0 10px -6px hsl(var(--foreground) / 0.35)"
        : undefined,
      maxWidth:
        isPinned === "right" &&
        column.columnDef.header?.toString() === "Actions"
          ? 60
          : undefined
    };
  };

  const navigation = useNavigation();
  const [params] = useUrlParams();
  const { hasFilters, clearFilters } = useFilters();
  const isLoading = useSpinDelay(navigation.state === "loading", {
    delay: 300
  });

  // Genuinely-empty table: no rows and nothing narrowing them
  // (filters/sorts/search). Single source of truth — passed to TableHeader so
  // the top toolbar and the bottom pagination footer hide together, leaving only
  // the title bar + primary action.
  const isTableEmpty =
    data.length === 0 &&
    !isFiltered &&
    !hasFilters &&
    params.getAll("sort").filter(Boolean).length === 0 &&
    !params.get("search")?.trim();

  // Phones export from the toolbar's ⋯ (list and grid alike); desktop keeps
  // the toolbar's Download button. Both export the table's current rows; an
  // infinite list first loads the rest (or hands a big export to a job).
  const csvExport = withCsvExport
    ? {
        data: tableData,
        columnAccessors,
        exportValues,
        exportOnlyColumns,
        columnOrder,
        columnVisibility,
        infinite: isInfinite
          ? {
              count,
              hasMore,
              listKey,
              loadAll: infiniteRows.loadAll,
              resetKey: infiniteRows.resetKey
            }
          : undefined
      }
    : undefined;

  if (isPhoneList) {
    return (
      <CompactList
        titleBadge={titleBadge}
        table={table}
        count={count}
        countIsExact={countIsExact}
        title={currentView?.name ?? title}
        tableName={tableName}
        filters={filters}
        sortKeyToLabel={sortKeyToLabel}
        withSearch={withSearch}
        withSort={sort !== null}
        withPagination={withPagination}
        infinite={isInfinite ? infiniteRows : undefined}
        isTruncated={isTruncated && !isInfinite}
        rowLimitNote={rowLimitNote}
        withSelectableRows={withSelectableRows}
        headerActions={headerActions}
        primaryAction={primaryAction}
        mobileMenuItems={mobileMenuItems}
        emptyState={emptyState}
        isLoading={isLoading}
        isTableEmpty={isTableEmpty}
        hasFilters={hasFilters}
        clearFilters={clearFilters}
        csvExport={csvExport}
        importCSV={importCSV}
        renderContextMenu={renderContextMenu}
        renderActions={scopedRenderActions}
        selectAllBar={selectAllBar}
        allMatchingCount={allMatching?.count}
        renderExpandedRow={renderExpandedRow}
        canExpandRow={canExpandRow}
        isRowExpanded={isRowExpanded}
        toggleRowExpanded={toggleRowExpanded}
        groupStarts={groupStarts}
        groupHeader={groupRowsBy?.header}
        totals={table
          .getAllLeafColumns()
          .filter((column) => column.columnDef.meta?.renderTotal)
          .map((column) => ({
            id: column.id,
            label:
              typeof column.columnDef.header === "string"
                ? column.columnDef.header
                : (column.columnDef.meta?.filterHeader ?? column.id),
            value: aggregateForCol(table, column.id, "sum"),
            formatter: column.columnDef.meta?.formatter
          }))}
      />
    );
  }

  // The empty-state ("No data exists") renders `primaryAction` too. When it
  // will, omit it from the header so only ONE copy mounts — a second mount of
  // the same `New` trips its `isSoleNew` guard and silently drops the keyboard
  // shortcut badge + binding on both.
  const headerPrimaryAction =
    rows.length === 0 && !isLoading && !emptyState && !hasFilters
      ? undefined
      : primaryAction;

  // The rows in view are each in their own `<tbody>`; an empty one stands in
  // for each run of rows that is not rendered.
  const spacerRow = (key: string, height: number) => (
    <tbody key={key} aria-hidden>
      <tr>
        <td colSpan={visibleColumns.length} style={{ height, padding: 0 }} />
      </tr>
    </tbody>
  );

  // Footer totals add up the loaded rows only, so an infinite list says so in
  // the first footer cell that holds nothing else.
  const footerLabelId =
    isInfinite &&
    visibleColumns.some((column) => column.columnDef.meta?.renderTotal)
      ? table
          .getFooterGroups()[0]
          ?.headers.find(
            (footer) =>
              !footer.isPlaceholder &&
              !SYNTHETIC_COLUMNS.has(footer.column.id) &&
              !footer.column.columnDef.meta?.renderTotal &&
              !footer.column.columnDef.footer
          )?.id
      : undefined;

  return (
    <VStack
      key={view ?? tableName ?? ""}
      spacing={0}
      className={cn(
        "h-full bg-card",
        !compact && "flex flex-col w-full px-0 md:px-4 lg:px-6",
        // Phones (grid mode): the toolbar spans the full width.
        "max-md:items-stretch"
      )}
    >
      {isPhone ? (
        <CompactToolbar
          title={currentView?.name ?? title}
          tableName={tableName}
          count={count}
          filters={filters}
          sortKeyToLabel={sortKeyToLabel}
          withSearch={withSearch}
          withSort={sort !== null}
          headerActions={
            <>
              {headerPrimaryAction}
              {headerActions}
            </>
          }
          csvExport={csvExport}
          titleBadge={titleBadge}
          importCSV={importCSV}
          hideControls={isTableEmpty}
        />
      ) : (
        <TableHeader
          columnAccessors={columnAccessors}
          exportValues={exportValues}
          exportOnlyColumns={exportOnlyColumns}
          sortKeyToLabel={sortKeyToLabel}
          columnOrder={columnOrder}
          columnPinning={columnPinning}
          columnVisibility={columnVisibility}
          columns={table.getAllLeafColumns()}
          compact={compact}
          data={tableData}
          infiniteExport={csvExport?.infinite}
          editMode={editMode}
          filters={filters}
          isEmpty={isTableEmpty}
          importCSV={importCSV}
          count={count}
          countIsExact={countIsExact}
          primaryAction={headerPrimaryAction}
          headerActions={headerActions}
          renderActions={scopedRenderActions}
          selectedRows={selectedRows}
          selectedCount={allMatching?.count ?? selectedRows.length}
          setColumnOrder={setColumnOrder}
          setEditMode={setEditMode}
          table={tableName}
          title={title}
          titleBadge={titleBadge}
          withInlineEditing={withInlineEditing}
          forceEditMode={forceEditMode}
          withPagination={withPagination}
          withSavedView={withSavedView}
          withSearch={withSearch}
          withSelectableRows={withSelectableRows}
          withSidebarTrigger={withSidebarTrigger}
          withColumnOrdering={withColumnOrdering}
          withCsvExport={withCsvExport}
          sort={sort}
        />
      )}
      {selectAllBar}

      <div
        id="table-container"
        className={cn(
          "w-full h-full overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent",
          // Phones, grids kept as grids: sideways scroll with an
          // edge fade, 16pt inset, and a sticky first column of at most 150pt.
          mobileLayout === "table" &&
            "max-md:scroll-fade-x max-md:px-4 max-md:[&_tr>*:first-child]:sticky max-md:[&_tr>*:first-child]:left-0 max-md:[&_tr>*:first-child]:z-10 max-md:[&_tr>*:first-child]:max-w-[150px] max-md:[&_tr>*:first-child]:bg-card"
        )}
        style={{ contain: "strict" }}
        ref={tableContainerRef}
        onKeyDownCapture={editMode ? onKeyDown : undefined}
      >
        <div className="flex max-w-full h-full">
          {rows.length === 0 ? (
            isLoading ? (
              <TableLoadingSkeleton />
            ) : emptyState ? (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                {emptyState}
              </div>
            ) : hasFilters ? (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background -mt-[10dvh]">
                  <LuTriangleAlert className="h-6 w-6 flex-shrink-0" />
                </div>
                <span className="text-xs font-mono font-light text-foreground uppercase">
                  <Trans>No results found</Trans>
                </span>
                <Button variant="secondary" onClick={clearFilters}>
                  <Trans>Remove Filters</Trans>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col w-full h-full items-center justify-center gap-4">
                <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background -mt-[10dvh]">
                  <LuTriangleAlert className="h-6 w-6 flex-shrink-0" />
                </div>
                <span className="text-xs font-mono font-light text-foreground uppercase">
                  <Trans>No data exists</Trans>
                </span>
                {primaryAction}
              </div>
            )
          ) : (
            <TableBase
              ref={tableRef}
              full
              className="relative border-collapse border-spacing-0"
            >
              <Thead ref={theadRef} className="sticky top-0 z-10">
                {table.getHeaderGroups().map((headerGroup) => (
                  <Tr key={headerGroup.id} className="h-10">
                    {headerGroup.headers.map((header) => {
                      const accessorKey = getAccessorKey(
                        header.column.columnDef
                      );

                      const sortable =
                        withSimpleSorting &&
                        isServerSortable(header.column.columnDef);
                      const sortKey =
                        header.column.columnDef.meta?.sortBy ?? accessorKey;
                      const sorted = isSorted(sortKey ?? "");

                      return (
                        <Th
                          key={header.id}
                          colSpan={header.colSpan}
                          id={`header-${header.id}`}
                          data-column-id={header.column.id}
                          aria-sort={
                            sorted === 1
                              ? "ascending"
                              : sorted === -1
                                ? "descending"
                                : undefined
                          }
                          className={cn(
                            "py-3 whitespace-nowrap bg-card",
                            header.column.id === "Select" ? "px-2" : "px-4",
                            editMode && "border-r-1 border-border",
                            sortable && "cursor-pointer"
                          )}
                          style={{
                            ...getPinnedStyles(header.column),
                            width: header.getSize(),
                            minWidth: minWidthStyle(
                              columnMinWidths.get(header.column.id)
                            )
                          }}
                        >
                          {!header.isPlaceholder &&
                            (sortable ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <div
                                    className={cn(
                                      "group flex items-center gap-2",
                                      header.column.columnDef.meta
                                        ?.headerClassName ?? "justify-start"
                                    )}
                                  >
                                    {header.column.columnDef.meta?.icon}
                                    {typeof header.column.columnDef.header ===
                                    "string"
                                      ? header.column.columnDef.header
                                      : flexRender(
                                          header.column.columnDef.header,
                                          header.getContext()
                                        )}
                                    <span className="inline-flex items-center">
                                      {sorted ? (
                                        sorted === -1 ? (
                                          <LuArrowDown
                                            aria-label="sorted descending"
                                            className="text-primary"
                                          />
                                        ) : (
                                          <LuArrowUp
                                            aria-label="sorted ascending"
                                            className="text-primary"
                                          />
                                        )
                                      ) : (
                                        <LuArrowUpDown
                                          aria-hidden="true"
                                          className="text-muted-foreground/50 md:opacity-0 transition-opacity group-hover:opacity-100"
                                        />
                                      )}
                                    </span>
                                  </div>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuRadioGroup
                                    value={sorted?.toString()}
                                  >
                                    <DropdownMenuRadioItem
                                      onClick={() =>
                                        toggleSortByAscending(sortKey!)
                                      }
                                      value="1"
                                    >
                                      <DropdownMenuIcon icon={<LuArrowUp />} />
                                      <Trans>Sort Ascending</Trans>
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem
                                      onClick={() =>
                                        toggleSortByDescending(sortKey!)
                                      }
                                      value="-1"
                                    >
                                      <DropdownMenuIcon
                                        icon={<LuArrowDown />}
                                      />
                                      <Trans>Sort Descending</Trans>
                                    </DropdownMenuRadioItem>
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <div
                                className={cn(
                                  "flex items-center gap-2",
                                  header.column.columnDef.meta
                                    ?.headerClassName ?? "justify-start"
                                )}
                              >
                                {header.column.columnDef.meta?.icon}
                                {typeof header.column.columnDef.header ===
                                "string"
                                  ? header.column.columnDef.header
                                  : flexRender(
                                      header.column.columnDef.header,
                                      header.getContext()
                                    )}
                              </div>
                            ))}
                        </Th>
                      );
                    })}
                  </Tr>
                ))}
              </Thead>
              {renderVirtualRows((virtualIndex) => {
                const row = rows[virtualIndex]!;
                const rowExpandable =
                  !!renderExpandedRow &&
                  (!canExpandRow || canExpandRow(row.original));
                const rowIsExpanded = rowExpandable && isRowExpanded(row.id);
                const handleRowClick = rowExpandable
                  ? () => toggleRowExpanded(row.id)
                  : undefined;
                const rowContent = renderContextMenu ? (
                  <Menu type="context">
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <Row
                          editableComponents={editableComponents}
                          isEditing={isEditing}
                          isEditMode={editMode}
                          isRowSelected={row.getIsSelected()}
                          visibleColumns={visibleColumns}
                          selectedCell={selectedCell}
                          row={row}
                          rowIsSelected={selectedCell?.row === row.index}
                          getPinnedStyles={getPinnedStyles}
                          pinnedStyleKey={pinnedStyleKey}
                          onCellClick={onCellClick}
                          onCellUpdate={onCellUpdate}
                          onClick={handleRowClick}
                          className={cn(
                            rowExpandable && "cursor-pointer",
                            getRowClassName?.(row.original)
                          )}
                        />
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-128">
                        {renderContextMenu(row.original)}
                      </ContextMenuContent>
                    </ContextMenu>
                  </Menu>
                ) : (
                  <Row
                    key={row.id}
                    editableComponents={editableComponents}
                    isEditing={isEditing}
                    isEditMode={editMode}
                    isRowSelected={row.getIsSelected()}
                    visibleColumns={visibleColumns}
                    selectedCell={selectedCell}
                    row={row}
                    rowIsSelected={selectedCell?.row === row.index}
                    getPinnedStyles={getPinnedStyles}
                    pinnedStyleKey={pinnedStyleKey}
                    onCellClick={onCellClick}
                    onCellUpdate={onCellUpdate}
                    onClick={handleRowClick}
                    className={cn(
                      rowExpandable && "cursor-pointer",
                      getRowClassName?.(row.original)
                    )}
                  />
                );

                const groupRows = groupStarts.get(row.id);

                return (
                  <Tbody
                    key={row.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualIndex}
                  >
                    {groupRows && groupRowsBy && (
                      <Tr>
                        <Td
                          colSpan={visibleColumns.length}
                          className="p-0 bg-muted/40 border-b border-border"
                        >
                          {/* As wide as the visible table, so a header
                              can put its actions at the right edge. */}
                          <div
                            className={cn(
                              "sticky left-0",
                              containerWidth === 0 && "w-fit"
                            )}
                            style={
                              containerWidth > 0
                                ? { width: containerWidth }
                                : undefined
                            }
                          >
                            {groupRowsBy.header(groupRows)}
                          </div>
                        </Td>
                      </Tr>
                    )}
                    {rowContent}
                    {rowIsExpanded && (
                      <Tr>
                        <Td
                          colSpan={visibleColumns.length}
                          className="p-0 bg-muted/20 border-b border-border"
                        >
                          {pinExpandedRows ? (
                            <div
                              className="sticky left-0"
                              style={
                                containerWidth > 0
                                  ? { width: containerWidth }
                                  : undefined
                              }
                            >
                              {renderExpandedRow(row.original)}
                            </div>
                          ) : (
                            renderExpandedRow(row.original)
                          )}
                        </Td>
                      </Tr>
                    )}
                  </Tbody>
                );
              }, spacerRow)}
              {isTruncated && !isInfinite && (
                <tbody>
                  <tr>
                    <td colSpan={visibleColumns.length} className="p-0">
                      <RowLimitNote className="sticky left-0 w-fit px-4 py-3">
                        {rowLimitNote}
                      </RowLimitNote>
                    </td>
                  </tr>
                </tbody>
              )}
              {isInfinite && (
                <tbody
                  ref={sentinelRef}
                  aria-hidden={!isLoadingMore && !loadError}
                >
                  <tr>
                    <td colSpan={visibleColumns.length} className="p-0">
                      <InfiniteStatus
                        isLoading={isLoadingMore}
                        loadError={loadError}
                        onRetry={retry}
                        className="sticky left-0 w-fit px-4 py-3"
                      />
                    </td>
                  </tr>
                </tbody>
              )}
              <Tbody>
                {table.getFooterGroups().map((footerGroup) => (
                  <Tr key={footerGroup.id} className="h-10">
                    {footerGroup.headers.map((footer) => {
                      const aggregateFn =
                        columnAggregates[footer.column.id] ?? "sum";
                      const total = aggregateForCol(
                        table,
                        footer.column.id,
                        aggregateFn
                      );
                      return (
                        <Th
                          key={footer.id}
                          colSpan={footer.colSpan}
                          id={`header-${footer.id}`}
                          className={cn(
                            "px-4 py-3 whitespace-nowrap bg-card",
                            editMode && "border-r-1 border-border"
                          )}
                          style={{
                            ...getPinnedStyles(footer.column),
                            width: footer.getSize()
                          }}
                        >
                          {!footer.isPlaceholder &&
                            (footer.column.columnDef.meta?.renderTotal ? (
                              <AggregateSelector
                                value={total}
                                aggregateFunction={aggregateFn}
                                onAggregateFunctionChange={(fn) => {
                                  setColumnAggregates((prev) => ({
                                    ...prev,
                                    [footer.column.id]: fn
                                  }));
                                }}
                                formatter={
                                  footer.column.columnDef.meta?.formatter
                                }
                              />
                            ) : footer.column.columnDef.footer ? (
                              // A caller-defined footer (e.g. a grid's
                              // per-column remainder), never editable.
                              flexRender(
                                footer.column.columnDef.footer,
                                footer.getContext()
                              )
                            ) : footer.id === footerLabelId ? (
                              <span className="font-normal text-muted-foreground">
                                <Plural
                                  value={rows.length}
                                  one="Total of # loaded row"
                                  other="Total of # loaded rows"
                                />
                              </span>
                            ) : null)}
                        </Th>
                      );
                    })}
                  </Tr>
                ))}
              </Tbody>
            </TableBase>
          )}
        </div>
      </div>
    </VStack>
  );
};

export default Table;
