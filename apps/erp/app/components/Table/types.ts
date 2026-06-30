import "@tanstack/react-table";
import type { ReactElement } from "react";
import type { ColumnFilterData } from "./components/Filter/types";

declare module "@tanstack/react-table" {
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  interface ColumnMeta<TData extends unknown, TValue> {
    filter?: ColumnFilterData;
    // Filter dropdown/chip label when `header` is JSX instead of a string.
    filterHeader?: string;
    pluralHeader?: string;
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
    // Server-sort column override. When set, the sort UI writes `?sort=<sortBy>:dir`
    // instead of using the accessorKey. Use when a column must sort by a different
    // field than its accessor (e.g. accessor `supplierTypeId`, sort by `type`).
    // Must name a real column on the view.
    sortBy?: string;
  }
}

export type ColumnSizeMap = Map<string, { width: number; startX: number }>;
