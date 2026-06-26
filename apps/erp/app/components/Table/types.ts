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
  }
}

export type ColumnSizeMap = Map<string, { width: number; startX: number }>;
