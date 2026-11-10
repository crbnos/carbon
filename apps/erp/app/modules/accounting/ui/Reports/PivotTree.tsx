// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  LuChartNoAxesColumnIncreasing,
  LuChevronDown,
  LuChevronRight,
  LuChevronsUpDown,
  LuChevronUp
} from "react-icons/lu";
import {
  LevelLine,
  TreeView,
  treeRowFocusClassName,
  useRovingTreeFocus,
  useTree
} from "~/components/TreeView";
import { useRealtime, useUrlParams } from "~/hooks";
import type { PivotMeasure, PivotState } from "../../accounting.models";
import type { DimensionPivot } from "../../types";
import { reportFrameClassName, useReportColumnStep } from "./ColumnStepper";
import type { PivotCellValue, PivotRowNode } from "./pivotData";
import {
  applyPercentOfTotal,
  buildPivotTree,
  getPivotMeasureValue,
  LABEL_SORT_KEY,
  TOTAL_SORT_KEY,
  UNASSIGNED_COLUMN_KEY
} from "./pivotData";
import {
  treegridBodyProps,
  treegridCellTarget,
  treegridNodeWrapperProps,
  treegridRowProps
} from "./treegrid";

const ROW_COLUMN_WIDTH = 360;
const VALUE_COLUMN_WIDTH = 128;

/**
 * Cell coordinates handed back on drill-through. NULL semantics mirror
 * getDimensionPivotLines: `rowValueNIsNull: true` means the Unassigned bucket
 * (constrain to lines with no tag for that dimension); `rowValueNId: null`
 * with `rowValueNIsNull: false` means no constraint on that axis (e.g. a
 * level-1 parent cell leaves the second row dimension unconstrained).
 * `columnKey` is the real column key (period end date or dimension value id);
 * it is null for the Unassigned column and for row-total cells — use
 * `isRowTotal` to tell those apart.
 */
export type PivotCellCoordinates = {
  rowValue1Id: string | null;
  rowValue1IsNull: boolean;
  rowValue2Id: string | null;
  rowValue2IsNull: boolean;
  columnKey: string | null;
  isRowTotal: boolean;
};

type PivotTreeProps = {
  pivot: DimensionPivot;
  state: PivotState;
  /**
   * columnKey → header label. The route computes period labels via
   * getPeriodColumnLabel and dimension labels via pivot.valueNames; the
   * Unassigned column label is supplied here (localized).
   */
  columnLabels: Record<string, string>;
  onCellClick: (coordinates: PivotCellCoordinates) => void;
};

// Same money formatting as MultiPeriodStatementTree.formatCurrency.
function formatAmount(value: number | null | undefined): string {
  if (value == null) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatMeasureValue(value: number, measure: PivotMeasure): string {
  if (measure === "amount") return formatAmount(value);
  if (measure === "quantity") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Enter/Space on a focused element runs the same action as a click on it. */
function onActivateKey(action: () => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  };
}

// The value cells of a row: out of the tab order, reached with the arrow keys
// from their row (ARIA treegrid).
const CELL_SELECTOR = "[data-treegrid-cell]";

/**
 * A row's keys: Enter/Space activate it, and Right on a row that shows no more
 * children (a leaf, or an expanded parent) moves into its first cell. Every
 * other key goes to the tree (Right on a collapsed parent expands it).
 */
function onRowKey(action: () => void, canEnterCells: boolean) {
  const activate = onActivateKey(action);
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowRight" && canEnterCells) {
      const cell = e.currentTarget.querySelector<HTMLElement>(CELL_SELECTOR);
      if (cell) {
        e.preventDefault();
        cell.focus();
      }
      return;
    }
    activate(e);
  };
}

/**
 * A cell's keys: Enter/Space open it, Left/Right move between the row's cells
 * and from the first cell back to the row. Up/Down go to the tree, which moves
 * to the next row.
 */
function onCellKey(action: () => void) {
  const activate = onActivateKey(action);
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    const row = e.currentTarget.closest<HTMLElement>('[role="row"]');
    const cells = row
      ? Array.from(row.querySelectorAll<HTMLElement>(CELL_SELECTOR))
      : [];
    const target = treegridCellTarget(
      e.key,
      cells.indexOf(e.currentTarget),
      cells.length
    );
    if (target === null || !row) {
      activate(e);
      return;
    }
    e.preventDefault();
    (target === "row" ? row : cells[target])?.focus();
  };
}

const PivotTree = memo(
  ({ pivot, state, columnLabels, onCellClick }: PivotTreeProps) => {
    const { t } = useLingui();
    const rowColumnWidth = ROW_COLUMN_WIDTH;
    const { locale } = useLocale();
    const [, setParams] = useUrlParams();
    useRealtime("journal");
    const parentRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLElement | null>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);

    // The tree's own element scrolls both axes; mirror its horizontal offset
    // onto the header and footer viewports so the columns stay aligned.
    useEffect(() => {
      const element = scrollRef.current;
      if (!element) return;
      const sync = () => {
        if (headerRef.current) {
          headerRef.current.scrollLeft = element.scrollLeft;
        }
        if (footerRef.current) {
          footerRef.current.scrollLeft = element.scrollLeft;
        }
      };
      element.addEventListener("scroll", sync, { passive: true });
      return () => element.removeEventListener("scroll", sync);
    }, []);

    const rowCount = Math.min(state.rows.length, 2) as 0 | 1 | 2;

    const pivotTree = useMemo(
      () =>
        buildPivotTree({
          groups: pivot.groups,
          valueNames: pivot.valueNames,
          columnKeys: pivot.columnKeys,
          rowCount,
          measure: state.measure,
          unassignedLabel: t`Unassigned`,
          totalLabel: t`Total`,
          sort: state.sort
        }),
      [pivot, rowCount, state.measure, state.sort, t]
    );

    const { flatTree, columnKeys, columnTotals, grandTotal } = pivotTree;
    const columnLabel = (columnKey: string) =>
      columnKey === UNASSIGNED_COLUMN_KEY
        ? t`Unassigned`
        : (columnLabels[columnKey] ?? columnKey);
    // Phones: one value column at a time; the last step is the row total,
    // shown first.
    const {
      isPhone,
      index: columnIndex,
      estimatedRowHeight,
      stepper
    } = useReportColumnStep({
      count: columnKeys.length + 1,
      label: (index) => {
        const columnKey = columnKeys[index];
        return columnKey === undefined ? t`Total` : columnLabel(columnKey);
      }
    });
    const phoneColumnKey: string | null =
      columnIndex < columnKeys.length
        ? (columnKeys[columnIndex] ?? null)
        : null;

    const percentFormatter = useMemo(
      () =>
        new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: 1,
          maximumFractionDigits: 1
        }),
      [locale]
    );

    const grandTotalValue = getPivotMeasureValue(grandTotal, state.measure);

    const formatCell = (
      cell: PivotCellValue | undefined,
      percent: number | undefined
    ): string => {
      if (state.percentOfTotal) {
        return percentFormatter.format((percent ?? 0) / 100);
      }
      return formatMeasureValue(
        getPivotMeasureValue(cell, state.measure),
        state.measure
      );
    };

    const formatRowTotal = (total: PivotCellValue): string => {
      const value = getPivotMeasureValue(total, state.measure);
      if (state.percentOfTotal) {
        const percent = grandTotalValue === 0 ? 0 : value / grandTotalValue;
        return percentFormatter.format(percent);
      }
      return formatMeasureValue(value, state.measure);
    };

    const cellCoordinates = (
      data: PivotRowNode,
      level: number,
      columnKey: string | null,
      isRowTotal: boolean
    ): PivotCellCoordinates => ({
      rowValue1Id: data.rowValue1Id,
      rowValue1IsNull: rowCount >= 1 && data.rowValue1Id === null,
      rowValue2Id: data.rowValue2Id,
      rowValue2IsNull:
        rowCount === 2 && level === 1 && data.rowValue2Id === null,
      columnKey:
        isRowTotal || columnKey === UNASSIGNED_COLUMN_KEY ? null : columnKey,
      isRowTotal
    });

    const {
      nodes,
      selected,
      getTreeProps,
      selectNode,
      toggleExpandNode,
      virtualizer
    } = useTree<PivotRowNode, undefined>({
      tree: flatTree,
      parentRef,
      estimatedRowHeight,
      isEager: true
    });
    const rovingFocus = useRovingTreeFocus({
      selected,
      selectNode,
      getTreeProps,
      parentRef,
      virtualizer
    });

    const totalColumnsWidth = columnKeys.length * VALUE_COLUMN_WIDTH;
    const rowWidth =
      rowColumnWidth + totalColumnsWidth + VALUE_COLUMN_WIDTH + 16;

    // Horizontal virtualizer over the value columns — thousands of columns stay
    // cheap because only the visible window renders in every row + header +
    // footer. It reads the tree's own horizontal scroller (scrollRef), the same
    // element the header/footer mirror their scrollLeft from.
    const columnVirtualizer = useVirtualizer({
      horizontal: true,
      count: columnKeys.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => VALUE_COLUMN_WIDTH,
      overscan: 6
    });
    const virtualColumns = columnVirtualizer.getVirtualItems();

    // Column-header sort: unsorted → firstDirection → opposite → unsorted.
    const cycleSort = (key: string, firstDirection: "asc" | "desc") => {
      const current = state.sort;
      let next: PivotState["sort"];
      if (!current || current.key !== key) {
        next = { key, direction: firstDirection };
      } else if (current.direction === firstDirection) {
        next = { key, direction: firstDirection === "asc" ? "desc" : "asc" };
      } else {
        next = null;
      }
      setParams({ sort: next ? `${next.key}:${next.direction}` : undefined });
    };

    const renderSortIndicator = (key: string) => {
      if (state.sort?.key === key) {
        return state.sort.direction === "asc" ? (
          <LuChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <LuChevronDown className="h-3.5 w-3.5 shrink-0" />
        );
      }
      return (
        <LuChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/header:opacity-60" />
      );
    };

    const ariaSort = (key: string) =>
      state.sort?.key === key
        ? state.sort.direction === "asc"
          ? ("ascending" as const)
          : ("descending" as const)
        : undefined;
    // 1-based column positions: the row label, the value columns, the total.
    const totalColumnIndex = columnKeys.length + 2;

    if (pivot.groups.length === 0) {
      return (
        <div className="flex h-[calc(100dvh-var(--header-height)-61px)] w-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <LuChartNoAxesColumnIncreasing className="h-8 w-8" />
          <p className="text-sm">
            <Trans>No journal lines in scope for this period</Trans>
          </p>
        </div>
      );
    }

    return (
      <div
        role="treegrid"
        aria-label={t`Pivot report`}
        aria-colcount={totalColumnIndex}
        className={cn("flex flex-col", reportFrameClassName)}
      >
        {pivot.hasMore && (
          <div className="shrink-0 border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
            <p>{t`Showing the top 1,000 groups by amount`}</p>
          </div>
        )}
        {isPhone ? (
          <>
            {stepper}
            {/* The stepper names the shown column; the header row stays for
                assistive tech. */}
            <div role="row" className="sr-only">
              <div role="columnheader" aria-colindex={1}>
                <Trans>Group</Trans>
              </div>
              <div
                role="columnheader"
                aria-colindex={
                  phoneColumnKey === null ? totalColumnIndex : columnIndex + 2
                }
              >
                {phoneColumnKey === null
                  ? t`Total`
                  : columnLabel(phoneColumnKey)}
              </div>
            </div>
          </>
        ) : (
          // Header viewport — scrollLeft is mirrored from the tree below
          <div ref={headerRef} className="shrink-0 overflow-x-hidden">
            <div
              role="row"
              className="relative flex h-12 items-center border-b border-border bg-card text-sm font-medium text-foreground/80"
              style={{ minWidth: rowWidth }}
            >
              {/* Row-label header — sorts rows alphabetically by label */}
              <div
                role="columnheader"
                aria-colindex={1}
                aria-sort={ariaSort(LABEL_SORT_KEY)}
                className="sticky left-0 z-[2] h-full shrink-0 bg-card"
                style={{ width: rowColumnWidth }}
              >
                <button
                  type="button"
                  className={cn(
                    "group/header flex h-full w-full items-center gap-1 px-4 text-muted-foreground hover:text-foreground",
                    state.sort?.key === LABEL_SORT_KEY && "text-foreground"
                  )}
                  onClick={() => cycleSort(LABEL_SORT_KEY, "asc")}
                >
                  <span className="sr-only">
                    <Trans>Group</Trans>
                  </span>
                  {renderSortIndicator(LABEL_SORT_KEY)}
                </button>
              </div>
              {virtualColumns.map((virtualColumn) => {
                const columnKey = columnKeys[virtualColumn.index];
                if (columnKey === undefined) return null;
                return (
                  <div
                    key={columnKey}
                    role="columnheader"
                    aria-colindex={virtualColumn.index + 2}
                    aria-sort={ariaSort(columnKey)}
                    className="absolute top-0 h-full"
                    style={{
                      left: rowColumnWidth + virtualColumn.start,
                      width: VALUE_COLUMN_WIDTH
                    }}
                  >
                    <button
                      type="button"
                      className={cn(
                        "group/header flex h-full w-full items-center justify-end gap-1 px-2 text-right hover:text-foreground",
                        columnKey === UNASSIGNED_COLUMN_KEY &&
                          "italic text-muted-foreground",
                        state.sort?.key === columnKey && "text-foreground"
                      )}
                      onClick={() => cycleSort(columnKey, "desc")}
                    >
                      <span className="truncate">{columnLabel(columnKey)}</span>
                      {renderSortIndicator(columnKey)}
                    </button>
                  </div>
                );
              })}
              {/* Total header — sorts rows by their total */}
              <div
                role="columnheader"
                aria-colindex={totalColumnIndex}
                aria-sort={ariaSort(TOTAL_SORT_KEY)}
                className="absolute top-0 h-full"
                style={{
                  left: rowColumnWidth + totalColumnsWidth,
                  width: VALUE_COLUMN_WIDTH
                }}
              >
                <button
                  type="button"
                  className={cn(
                    "group/header flex h-full w-full items-center justify-end gap-1 px-2 text-right hover:text-foreground",
                    state.sort?.key === TOTAL_SORT_KEY && "text-foreground"
                  )}
                  onClick={() => cycleSort(TOTAL_SORT_KEY, "desc")}
                >
                  <Trans>Total</Trans>
                  {renderSortIndicator(TOTAL_SORT_KEY)}
                </button>
              </div>
            </div>
          </div>
        )}
        <TreeView<PivotRowNode>
          tree={flatTree}
          nodes={nodes}
          getTreeProps={treegridBodyProps(rovingFocus.getTreeProps)}
          getNodeProps={treegridNodeWrapperProps}
          virtualizer={virtualizer}
          parentRef={parentRef}
          scrollRef={scrollRef}
          parentClassName="flex-1 overflow-x-auto"
          contentMinWidth={isPhone ? undefined : rowWidth}
          renderNode={({ node, state: nodeState }) => {
            const row = node.data;
            const percents = state.percentOfTotal
              ? applyPercentOfTotal(row.cells, columnTotals, state.measure)
              : undefined;

            // Right enters the cells once a row shows no more children.
            const canEnterCells = !node.hasChildren || nodeState.expanded;

            if (isPhone) {
              const isTotal = phoneColumnKey === null;
              const activateRow = () => {
                selectNode(node.id, false);
                if (node.hasChildren) toggleExpandNode(node.id);
              };
              const openPhoneCell = () =>
                onCellClick(
                  cellCoordinates(row, node.level, phoneColumnKey, isTotal)
                );
              return (
                <div
                  role="row"
                  {...treegridRowProps({
                    level: node.level,
                    hasChildren: node.hasChildren,
                    expanded: nodeState.expanded
                  })}
                  aria-selected={nodeState.selected}
                  {...rovingFocus.getRowProps(node.id)}
                  className={cn(
                    "flex h-11 cursor-pointer items-center pr-2 text-sm",
                    treeRowFocusClassName,
                    nodeState.selected ? "bg-muted" : "bg-transparent",
                    node.hasChildren && "font-semibold"
                  )}
                  onClick={activateRow}
                  onKeyDown={onRowKey(activateRow, canEnterCells)}
                >
                  <div
                    role="rowheader"
                    className="flex min-w-0 flex-1 items-center"
                  >
                    <div className="flex h-9 shrink-0 items-center">
                      {Array.from({ length: node.level }).map((_, index) => (
                        <LevelLine
                          key={index}
                          isSelected={nodeState.selected}
                        />
                      ))}
                      <div className="flex h-9 w-5 items-center justify-center">
                        {node.hasChildren ? (
                          nodeState.expanded ? (
                            <LuChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <LuChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          )
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate pl-2 pr-2",
                        row.isUnassigned && "italic text-muted-foreground"
                      )}
                    >
                      {row.label}
                    </span>
                  </div>
                  <span
                    role="gridcell"
                    aria-colindex={isTotal ? totalColumnIndex : columnIndex + 2}
                    className="shrink-0"
                  >
                    <span
                      role="button"
                      tabIndex={-1}
                      data-treegrid-cell
                      className={cn(
                        "block px-2 text-right tabular-nums text-muted-foreground",
                        isTotal && "font-medium"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        openPhoneCell();
                      }}
                      onKeyDown={onCellKey(openPhoneCell)}
                    >
                      {phoneColumnKey === null
                        ? formatRowTotal(row.total)
                        : formatCell(
                            row.cells[phoneColumnKey],
                            percents?.[phoneColumnKey]
                          )}
                    </span>
                  </span>
                </div>
              );
            }

            const activateRow = () => {
              selectNode(node.id, false);
              if (node.hasChildren) {
                toggleExpandNode(node.id);
              }
            };

            return (
              <div
                role="row"
                {...treegridRowProps({
                  level: node.level,
                  hasChildren: node.hasChildren,
                  expanded: nodeState.expanded
                })}
                aria-selected={nodeState.selected}
                {...rovingFocus.getRowProps(node.id)}
                className={cn(
                  "relative flex h-8 cursor-pointer items-center text-sm group/row",
                  treeRowFocusClassName,
                  nodeState.selected
                    ? "bg-muted hover:bg-accent"
                    : "bg-transparent hover:bg-accent",
                  node.hasChildren && "font-semibold"
                )}
                style={{ minWidth: rowWidth }}
                onClick={activateRow}
                onKeyDown={onRowKey(activateRow, canEnterCells)}
              >
                {/* Pinned row cell: indentation + chevron + label */}
                <div
                  role="rowheader"
                  aria-colindex={1}
                  className={cn(
                    "sticky left-0 z-[1] flex h-full shrink-0 items-center overflow-hidden",
                    nodeState.selected
                      ? "bg-muted group-hover/row:bg-accent"
                      : "bg-card group-hover/row:bg-accent"
                  )}
                  style={{ width: rowColumnWidth }}
                >
                  {/* Indentation lines */}
                  <div className="flex h-9 items-center">
                    {Array.from({ length: node.level }).map((_, index) => (
                      <LevelLine key={index} isSelected={nodeState.selected} />
                    ))}

                    {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut only; the row toggles parents on Enter and carries aria-expanded */}
                    <div
                      role="presentation"
                      className={cn(
                        "flex h-9 w-5 items-center justify-center",
                        node.hasChildren && "hover:bg-accent"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpandNode(node.id);
                      }}
                    >
                      {node.hasChildren ? (
                        nodeState.expanded ? (
                          <LuChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <LuChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )
                      ) : (
                        <div className="h-9 w-5" />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-1 items-center gap-2 overflow-hidden pl-2 pr-2">
                    <span
                      className={cn(
                        "truncate",
                        row.isUnassigned && "italic text-muted-foreground"
                      )}
                    >
                      {row.label}
                    </span>
                  </div>
                </div>

                {/* Virtualized value cells — only the visible column window */}
                {virtualColumns.map((virtualColumn) => {
                  const columnKey = columnKeys[virtualColumn.index];
                  if (columnKey === undefined) return null;
                  const openCell = () =>
                    onCellClick(
                      cellCoordinates(row, node.level, columnKey, false)
                    );
                  return (
                    <span
                      key={columnKey}
                      role="gridcell"
                      aria-colindex={virtualColumn.index + 2}
                      className="absolute top-0 h-full"
                      style={{
                        left: rowColumnWidth + virtualColumn.start,
                        width: VALUE_COLUMN_WIDTH
                      }}
                    >
                      <span
                        role="button"
                        tabIndex={-1}
                        data-treegrid-cell
                        className="flex h-full w-full cursor-pointer items-center justify-end px-2 text-right tabular-nums text-muted-foreground hover:text-foreground hover:underline underline-offset-2 decoration-border"
                        // Scrolled into view clear of the pinned row column.
                        style={{ scrollMarginLeft: rowColumnWidth }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openCell();
                        }}
                        onKeyDown={onCellKey(openCell)}
                      >
                        {formatCell(
                          row.cells[columnKey],
                          percents?.[columnKey]
                        )}
                      </span>
                    </span>
                  );
                })}

                {/* Row total */}
                <span
                  role="gridcell"
                  aria-colindex={totalColumnIndex}
                  className="absolute top-0 h-full"
                  style={{
                    left: rowColumnWidth + totalColumnsWidth,
                    width: VALUE_COLUMN_WIDTH
                  }}
                >
                  <span
                    role="button"
                    tabIndex={-1}
                    data-treegrid-cell
                    className="flex h-full w-full cursor-pointer items-center justify-end px-2 text-right font-medium tabular-nums text-muted-foreground hover:text-foreground hover:underline underline-offset-2 decoration-border"
                    style={{ scrollMarginLeft: rowColumnWidth }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCellClick(cellCoordinates(row, node.level, null, true));
                    }}
                    onKeyDown={onCellKey(() =>
                      onCellClick(cellCoordinates(row, node.level, null, true))
                    )}
                  >
                    {formatRowTotal(row.total)}
                  </span>
                </span>
              </div>
            );
          }}
        />
        {isPhone ? (
          <div
            role="row"
            className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-border bg-card px-4 text-sm font-semibold"
          >
            <span role="rowheader" aria-colindex={1}>
              <Trans>Total</Trans>
            </span>
            <span
              role="gridcell"
              aria-colindex={
                phoneColumnKey === null ? totalColumnIndex : columnIndex + 2
              }
              className="tabular-nums"
            >
              {phoneColumnKey === null
                ? state.percentOfTotal
                  ? percentFormatter.format(grandTotalValue === 0 ? 0 : 1)
                  : formatMeasureValue(grandTotalValue, state.measure)
                : state.percentOfTotal
                  ? percentFormatter.format(
                      getPivotMeasureValue(
                        columnTotals[phoneColumnKey],
                        state.measure
                      ) === 0
                        ? 0
                        : 1
                    )
                  : formatMeasureValue(
                      getPivotMeasureValue(
                        columnTotals[phoneColumnKey],
                        state.measure
                      ),
                      state.measure
                    )}
            </span>
          </div>
        ) : (
          // Column totals footer — scrollLeft mirrored from the tree above
          <div ref={footerRef} className="shrink-0 overflow-x-hidden">
            <div
              role="row"
              className="relative flex h-9 items-center border-t border-border bg-card text-sm font-semibold"
              style={{ minWidth: rowWidth }}
            >
              <div
                role="rowheader"
                aria-colindex={1}
                className="sticky left-0 z-[2] flex h-full shrink-0 items-center bg-card px-4"
                style={{ width: rowColumnWidth }}
              >
                <Trans>Total</Trans>
              </div>
              {virtualColumns.map((virtualColumn) => {
                const columnKey = columnKeys[virtualColumn.index];
                if (columnKey === undefined) return null;
                return (
                  <span
                    key={columnKey}
                    role="gridcell"
                    aria-colindex={virtualColumn.index + 2}
                    className="absolute top-0 flex h-full items-center justify-end px-2 text-right tabular-nums"
                    style={{
                      left: rowColumnWidth + virtualColumn.start,
                      width: VALUE_COLUMN_WIDTH
                    }}
                  >
                    {state.percentOfTotal
                      ? percentFormatter.format(
                          getPivotMeasureValue(
                            columnTotals[columnKey],
                            state.measure
                          ) === 0
                            ? 0
                            : 1
                        )
                      : formatMeasureValue(
                          getPivotMeasureValue(
                            columnTotals[columnKey],
                            state.measure
                          ),
                          state.measure
                        )}
                  </span>
                );
              })}
              <span
                role="gridcell"
                aria-colindex={totalColumnIndex}
                className="absolute top-0 flex h-full items-center justify-end px-2 text-right tabular-nums"
                style={{
                  left: rowColumnWidth + totalColumnsWidth,
                  width: VALUE_COLUMN_WIDTH
                }}
              >
                {state.percentOfTotal
                  ? percentFormatter.format(grandTotalValue === 0 ? 0 : 1)
                  : formatMeasureValue(grandTotalValue, state.measure)}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }
);

PivotTree.displayName = "PivotTree";
export default PivotTree;
