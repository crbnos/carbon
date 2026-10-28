// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ActionMenu } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { MutableRefObject } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import IndeterminateCheckbox from "./IndeterminateCheckbox";

// The columns the Table adds itself: expand, select and actions.

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
  actionsLabel: string
): ColumnDef<T>[] {
  return [
    {
      id: "Actions",
      header: () => <span className="sr-only">{actionsLabel}</span>,
      cell: (item) => (
        <div className="flex justify-end">
          <ActionMenu>{renderContextMenu(item.row.original)}</ActionMenu>
        </div>
      ),
      size: 60
    }
  ];
}

export function getExpandColumn<T>(
  isRowExpanded: (rowId: string) => boolean,
  toggleRowExpanded: (rowId: string) => void,
  labels: { expand: string; expandRow: string; collapseRow: string },
  canExpandRow?: (row: T) => boolean
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
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleRowExpanded(row.id);
            }}
            className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
            aria-label={isExpanded ? labels.collapseRow : labels.expandRow}
          >
            {isExpanded ? (
              <LuChevronDown className="size-4" />
            ) : (
              <LuChevronRight className="size-4" />
            )}
          </button>
        );
      }
    }
  ];
}
