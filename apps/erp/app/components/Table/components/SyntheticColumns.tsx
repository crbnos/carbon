// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ActionMenu, cn } from "@carbon/react";
import type { ColumnDef, Row } from "@tanstack/react-table";
import type { MutableRefObject } from "react";
import { LuChevronRight } from "react-icons/lu";
import IndeterminateCheckbox from "./IndeterminateCheckbox";

// The columns the Table adds itself: expand, select and actions.

const SYNTHETIC_COLUMN_IDS = new Set(["Select", "Actions", "Expand"]);
// A bare record id ("ckq3x9z0a0000…") names nothing a user can see.
const ID_LIKE = /^[A-Za-z0-9_-]{20,}$/;

/**
 * What a row is called in its controls' names ("Actions for PO-000123",
 * "Select PO-000123"): the table's `getRowLabel`, else the first visible
 * column whose value is text. Undefined when neither gives one.
 */
export function rowLabelOf<T>(
  row: Row<T>,
  getRowLabel?: (row: T) => string | undefined
): string | undefined {
  const explicit = getRowLabel?.(row.original)?.trim();
  if (explicit) return explicit;
  for (const cell of row.getVisibleCells()) {
    if (SYNTHETIC_COLUMN_IDS.has(cell.column.id)) continue;
    const value = cell.getValue();
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text && !ID_LIKE.test(text)) return text;
  }
  return undefined;
}

export function getRowSelectionColumn<T>(
  anchorRef: MutableRefObject<string | null>
): ColumnDef<T>[] {
  return [
    {
      id: "Select",
      // width:1 + whitespace-nowrap = shrink-to-fit. A fixed pixel width
      // inflates on w-full auto-layout tables because leftover space is
      // distributed proportionally to specified column widths.
      size: 1,
      minSize: 1,
      enablePinning: true,
      header: ({ table }) => (
        <IndeterminateCheckbox
          selects="all"
          {...{
            checked: table.getIsAllRowsSelected(),
            indeterminate: table.getIsSomeRowsSelected(),
            onChange: (checked: boolean) => {
              table.toggleAllRowsSelected(checked);
              anchorRef.current = null;
            }
          }}
        />
      ),
      cell: ({ row, table }) => (
        <IndeterminateCheckbox
          selects={row.index + 1}
          rowLabel={rowLabelOf(row, table.options.meta?.getRowLabel)}
          {...{
            checked: row.getIsSelected(),
            indeterminate: row.getIsSomeSelected(),
            onChange: (checked: boolean, shiftKey: boolean) => {
              const rows = table.getRowModel().rows;
              const clickedIndex = rows.findIndex((r) => r.id === row.id);
              const anchorIndex =
                anchorRef.current == null
                  ? -1
                  : rows.findIndex((r) => r.id === anchorRef.current);

              if (shiftKey && anchorIndex !== -1 && clickedIndex !== -1) {
                const start = Math.min(anchorIndex, clickedIndex);
                const end = Math.max(anchorIndex, clickedIndex);
                table.setRowSelection((prev) => {
                  const next = { ...prev };
                  for (let i = start; i <= end; i++) {
                    const id = rows[i].id;
                    if (checked) next[id] = true;
                    else delete next[id];
                  }
                  return next;
                });
                // Keep the anchor fixed so the range can be re-dragged.
                return;
              }

              row.toggleSelected(checked);
              anchorRef.current = row.id;
            }
          }}
        />
      )
    }
  ];
}

export function getActionColumn<T>(
  renderContextMenu: (item: T) => JSX.Element | null,
  actionsLabel: string,
  actionsFor: (rowLabel: string) => string
): ColumnDef<T>[] {
  return [
    {
      id: "Actions",
      header: () => <span className="sr-only">{actionsLabel}</span>,
      cell: ({ row, table }) => {
        const rowLabel = rowLabelOf(row, table.options.meta?.getRowLabel);
        return (
          <div className="flex justify-end">
            <ActionMenu label={rowLabel ? actionsFor(rowLabel) : undefined}>
              {renderContextMenu(row.original)}
            </ActionMenu>
          </div>
        );
      },
      size: 60
    }
  ];
}

export function getExpandColumn<T>(
  isRowExpanded: (rowId: string) => boolean,
  toggleRowExpanded: (rowId: string) => void,
  labels: { expand: string; expandRow: string; collapseRow: string },
  canExpandRow?: (row: T) => boolean,
  prefetchRow?: (row: T) => void
): ColumnDef<T>[] {
  return [
    {
      id: "Expand",
      size: 40,
      enablePinning: true,
      header: () => <span className="sr-only">{labels.expand}</span>,
      cell: ({ row }) => {
        // No chevron for rows that have nothing to reveal (tree `hasChildren`).
        if (canExpandRow && !canExpandRow(row.original)) return null;
        const isExpanded = isRowExpanded(row.id);
        return (
          <button
            aria-expanded={isExpanded}
            type="button"
            // A click lands ~100 ms after the press; start the read now. Only a
            // primary mouse or pen press: a touch here may start a scroll.
            onPointerDown={(e) => {
              if (isExpanded || e.button !== 0 || e.pointerType === "touch") {
                return;
              }
              prefetchRow?.(row.original);
            }}
            onClick={(e) => {
              e.stopPropagation();
              toggleRowExpanded(row.id);
            }}
            className="rounded p-1 text-muted-foreground transition-[color,background-color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]"
            aria-label={isExpanded ? labels.collapseRow : labels.expandRow}
          >
            <LuChevronRight
              className={cn(
                "size-4 transition-transform duration-150 ease-out motion-reduce:transition-none",
                isExpanded && "rotate-90"
              )}
            />
          </button>
        );
      }
    }
  ];
}
