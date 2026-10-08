// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import "@tanstack/react-table";
import type { CellContext } from "@tanstack/react-table";
import type { ReactElement, ReactNode } from "react";
import type { ColumnFilterData } from "./components/Filter/types";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends unknown, TValue> {
    filter?: ColumnFilterData;
    // Filter dropdown/chip label when `header` is JSX instead of a string.
    filterHeader?: string;
    pluralHeader?: string;
    // Extra classes for the header content wrapper (e.g. "justify-center" to
    // center a header). Defaults to left-aligned (`justify-start`).
    headerClassName?: string;
    icon?: ReactElement;
    renderTotal?: boolean;
    formatter?: (
      val:
        | number
        | bigint
        | `${number}`
        | "Infinity"
        | "-Infinity"
        | "+Infinity"
    ) => string;
    // CSV value for this column, given the full row. Overrides the raw-accessor
    // read in Download.tsx. Use when the displayed value is derived/composite, or
    // when the accessorKey is an id whose name lives in another row field.
    exportValue?: (row: TData) => string | number | boolean | null | undefined;
    // Export-only column: never rendered in the grid (Table force-hides it), but
    // still emitted to the CSV via `exportValue`. Use for values that belong in
    // the export but not the on-screen table (e.g. a tokenized download link).
    // Pair with `filterHeader` to supply the CSV heading, since `header` is
    // typically left blank to keep the column out of the column-visibility menu.
    exportOnly?: boolean;
    // Server-sort column override. When set, the sort UI writes `?sort=<sortBy>:dir`
    // instead of using the accessorKey. Use when a column must sort by a different
    // field than its accessor (e.g. accessor `supplierTypeId`, sort by `type`).
    // Must name a real column on the view.
    sortBy?: string;
    // Phone list priority: P1 = identity (line 1), P2 = trailing metric
    // or status pill, P3 = context (line 2); P4 or unset = not in the row.
    // "action" = the row's one trailing button (e.g. "Make 90"), hidden in
    // selection mode. See Table/components/Compact/resolveSlots.ts.
    mobile?: "P1" | "P2" | "P3" | "P4" | "action";
    /** Phones: show this P2 column as a status pill on line 3 (a status column without a static filter). */
    mobilePill?: boolean;
    /** Phones: lead this column's value with its (string) header, since a
     *  list row shows no column headers. */
    mobileLabel?: boolean;
    /** Phones: renders this column in the list row instead of `cell`. */
    mobileCell?: (context: CellContext<TData, TValue>) => ReactNode;
  }
}

export type ColumnSizeMap = Map<string, { width: number; startX: number }>;
