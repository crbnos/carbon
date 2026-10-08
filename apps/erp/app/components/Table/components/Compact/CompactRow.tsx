// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, EnumerableAsText } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { Cell, Column, Row } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import { LuChevronRight } from "react-icons/lu";
import IndeterminateCheckbox from "../IndeterminateCheckbox";
import type { CompactSlots } from "./resolveSlots";

function renderCell<T>(row: Row<T>, column: Column<T, unknown> | undefined) {
  if (!column) return null;
  const cell = row.getAllCells().find((c) => c.column.id === column.id) as
    | Cell<T, unknown>
    | undefined;
  if (!cell) return null;
  const { header, meta } = cell.column.columnDef;
  const value = flexRender(
    meta?.mobileCell ?? cell.column.columnDef.cell,
    cell.getContext()
  );
  if (!meta?.mobileLabel || typeof header !== "string") return value;
  return (
    <>
      <span className="mr-1 text-[13px] text-muted-foreground">{header}</span>
      {value}
    </>
  );
}

type CompactRowProps<T> = {
  row: Row<T>;
  slots: CompactSlots<T>;
  selection?: { selected: boolean; onToggle: () => void };
  expansion?: { expanded: boolean; onToggle: () => void };
  className?: string;
};

/**
 * One list row: line 1 = identity (P1) with the metric (P2) trailing,
 * line 2 = context (P3), line 3 = status pills. Each slot renders the
 * column's own cell (or its `meta.mobileCell`), so links, pills and money
 * formats are the desktop ones.
 * The P1 link is stretched over the row, so a tap anywhere opens the record
 * at the desktop href; other controls sit above it.
 */
export function CompactRow<T>({
  row,
  slots,
  selection,
  expansion,
  className
}: CompactRowProps<T>) {
  const { t } = useLingui();
  const p2 = renderCell(row, slots.p2);
  const p3 = renderCell(row, slots.p3);
  // In selection mode a tap selects the row, so the row action hides.
  const action = selection ? null : renderCell(row, slots.action);
  const pills = slots.pills
    .map((column) => ({ id: column.id, node: renderCell(row, column) }))
    .filter((pill) => pill.node !== null);

  return (
    <div
      className={cn(
        "relative flex min-h-14 items-start gap-3 bg-card px-4 py-3",
        // A one-line row centres its content vertically.
        p3 === null && pills.length === 0 && "items-center",
        "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-4 after:h-px after:bg-border",
        // With a leading thumbnail in P1, the divider starts at the text column.
        "[&:has([data-p1]_[data-thumbnail=sm])]:after:left-14 [&:has([data-p1]_[data-thumbnail=md])]:after:left-16 [&:has([data-p1]_[data-thumbnail=lg])]:after:left-[68px]",
        "[&:has([data-p1]_[data-avatar=xs])]:after:left-12 [&:has([data-p1]_[data-avatar=sm])]:after:left-14",
        selection?.selected && "bg-accent/60",
        className
      )}
    >
      {selection ? (
        <div className="relative z-10 flex size-6 shrink-0 items-center justify-center pt-0.5">
          <IndeterminateCheckbox
            checked={selection.selected}
            indeterminate={false}
            onChange={selection.onToggle}
          />
        </div>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1",
          // Lines 2 and 3 start at the text column, past a P1 thumbnail (+8 gap).
          "[&:has([data-p1]_[data-thumbnail=sm])>[data-line]]:pl-10 [&:has([data-p1]_[data-thumbnail=md])>[data-line]]:pl-12 [&:has([data-p1]_[data-thumbnail=lg])>[data-line]]:pl-[52px]",
          // …and past a P1 avatar.
          "[&:has([data-p1]_[data-avatar=xs])>[data-line]]:pl-8 [&:has([data-p1]_[data-avatar=sm])>[data-line]]:pl-10"
        )}
      >
        <div className="flex min-w-0 items-start gap-3 [&:has(>[data-p1]_[data-thumbnail])]:items-center [&:has(>[data-p1]_[data-avatar])]:items-center">
          <div
            data-p1
            className={cn(
              "min-w-0 flex-1 truncate text-[15px] font-medium text-foreground",
              // Stretch the identity link over the whole row; with selection
              // active a tap toggles the row instead.
              !selection &&
                "[&_a:first-of-type]:after:absolute [&_a:first-of-type]:after:inset-0 [&_a:first-of-type]:after:content-['']",
              "[&_*]:min-w-0 [&_*]:truncate",
              // Controls inside the identity cell (expand chevrons) stay
              // tappable above the stretched link.
              "[&_button]:relative [&_button]:z-10"
            )}
          >
            {renderCell(row, slots.p1)}
          </div>
          {p2 !== null ? (
            <div className="max-w-[45%] shrink-0 truncate text-right text-[15px] tabular-nums text-foreground [&_*]:truncate [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10">
              {p2}
            </div>
          ) : null}
        </div>
        {p3 !== null ? (
          // Context line: not raised above the row link, so a tap anywhere on
          // it opens the row's record, never the linked one. Column stacks turn
          // into a row here, so their parts need a gap.
          <div
            data-line
            className="min-w-0 truncate text-[13px] text-muted-foreground [&_*]:truncate [&>*]:!flex-row [&>*]:items-center [&>[class~=flex-col]]:!gap-x-1.5"
          >
            <EnumerableAsText value>{p3}</EnumerableAsText>
          </div>
        ) : null}
        {pills.length > 0 ? (
          <div
            data-line
            className="flex min-w-0 flex-wrap items-center gap-1.5 [&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10"
          >
            {pills.map((pill) => (
              <div
                key={pill.id}
                className="min-w-0 max-w-full truncate empty:hidden"
              >
                {pill.node}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {action !== null ? (
        <div className="relative z-10 shrink-0 self-center [&_button]:h-11 [&_button]:min-w-11">
          {action}
        </div>
      ) : null}
      {expansion ? (
        <button
          type="button"
          aria-expanded={expansion.expanded}
          aria-label={expansion.expanded ? t`Collapse` : t`Expand`}
          onClick={expansion.onToggle}
          className="relative z-10 -my-2 -mr-2 flex size-11 shrink-0 items-center justify-center text-muted-foreground"
        >
          <LuChevronRight
            className={cn(
              "size-5 transition-transform",
              expansion.expanded && "rotate-90"
            )}
          />
        </button>
      ) : null}
      {selection ? (
        <button
          type="button"
          aria-label={t`Select row`}
          className="absolute inset-0"
          onClick={selection.onToggle}
        />
      ) : null}
    </div>
  );
}
