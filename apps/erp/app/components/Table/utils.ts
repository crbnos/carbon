import type { ColumnDef } from "@tanstack/react-table";

export function getAccessorKey<T>(columnDef: ColumnDef<T, unknown>) {
  return "accessorKey" in columnDef
    ? columnDef?.accessorKey.toString()
    : undefined;
}

export interface ColumnMaps<T> {
  // accessorKey (or column id for display columns) -> translated header label
  accessors: Record<string, string>;
  // export key -> function returning the CSV value for the full row
  exportValues: Record<string, (row: T) => unknown>;
  // server sort key (`meta.sortBy ?? accessorKey`) -> translated header label
  sortKeyToLabel: Record<string, string>;
  // export keys flagged `meta.exportOnly` — rendered nowhere in the grid but
  // still emitted to CSV. Table.tsx force-hides these columns.
  exportOnlyColumns: string[];
}

// Derives every column-driven map the table header needs: CSV column headings,
// per-column export overrides, and the sort-key -> label lookup used by the sort
// UI. A column's accessorKey drives value + filter, but sort (meta.sortBy) and
// export (meta.exportValue) can each point at a different field.
export function buildColumnMaps<T>(
  columns: ColumnDef<T, unknown>[],
  translate: (value: string) => string
): ColumnMaps<T> {
  const accessors: Record<string, string> = {};
  const exportValues: Record<string, (row: T) => unknown> = {};
  const sortKeyToLabel: Record<string, string> = {};
  const exportOnlyColumns: string[] = [];

  for (const column of columns) {
    const accessorKey = getAccessorKey(column);
    if (accessorKey?.includes("_")) {
      throw new Error(`Invalid accessorKey ${accessorKey}. Cannot contain '_'`);
    }

    const stringHeader =
      typeof column.header === "string" ? column.header : undefined;
    const filterHeader = column.meta?.filterHeader;
    const exportValue = column.meta?.exportValue;
    const exportKey = accessorKey ?? column.id;

    // CSV heading: a non-empty string header wins, then filterHeader (covers
    // JSX-header and blank-header columns), then a (possibly empty) string
    // header — never invents a heading for a JSX header that lacks filterHeader.
    const rawLabel =
      stringHeader && stringHeader.length > 0
        ? stringHeader
        : (filterHeader ?? stringHeader);
    const exportLabel =
      rawLabel !== undefined ? translate(rawLabel) : undefined;

    const includeInExport =
      (!!accessorKey && stringHeader !== undefined) || !!exportValue;
    if (includeInExport && exportKey && exportLabel !== undefined) {
      accessors[exportKey] = exportLabel;
    }

    if (exportValue && exportKey) {
      exportValues[exportKey] = exportValue;
    }

    if (column.meta?.exportOnly && exportKey) {
      exportOnlyColumns.push(exportKey);
    }

    // Sort picker stays keyed on string-header columns only, so JSX-header
    // columns (e.g. MRP week columns with a filterHeader) never flood it.
    if (accessorKey && stringHeader !== undefined) {
      const sortKey = column.meta?.sortBy ?? accessorKey;
      sortKeyToLabel[sortKey] = translate(stringHeader);
    }
  }

  return { accessors, exportValues, sortKeyToLabel, exportOnlyColumns };
}

// The columns a CSV export should emit, in the current view's order. A column
// id doubles as its data accessor key; ids absent from columnAccessors
// (selection, expand, actions) are dropped.
export function selectExportColumns(args: {
  columnAccessors: Record<string, string>;
  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  exportOnlyColumns: string[];
}): string[] {
  const { columnAccessors, columnOrder, columnVisibility, exportOnlyColumns } =
    args;

  // A saved view stores the column order from when it was saved, so it omits
  // export-only columns added since. They render nowhere in the grid, so the
  // user can never reorder them back in — append any the stored order missed
  // rather than silently dropping them from the export.
  const order = columnOrder.length
    ? [
        ...columnOrder,
        ...exportOnlyColumns.filter((id) => !columnOrder.includes(id))
      ]
    : Object.keys(columnAccessors);

  return order.filter(
    (id) =>
      id in columnAccessors &&
      // Export-only columns export regardless of grid visibility; everything
      // else follows the visible-in-the-current-view rule.
      (exportOnlyColumns.includes(id) || columnVisibility[id] !== false)
  );
}

// A column that exists only to add a field to the CSV — never rendered in the
// grid (Table force-hides `exportOnly`). `header` is blank so the column stays
// out of the visibility menu; the CSV heading comes from `filterHeader`.
export function exportOnlyColumn<T>(opts: {
  // Column id, doubles as the export key. Cannot contain '_' (buildColumnMaps).
  id: string;
  // Already-translated heading, e.g. t`Item Name`.
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}): ColumnDef<T, unknown> {
  return {
    id: opts.id,
    header: "",
    cell: () => null,
    meta: {
      exportOnly: true,
      filterHeader: opts.header,
      exportValue: opts.value
    }
  };
}

export function updateNestedProperty(
  obj: object,
  path: string | string[],
  value: unknown
): unknown {
  if (typeof path == "string")
    return updateNestedProperty(obj, path.split("_"), value);
  else if (path.length == 1 && value !== undefined)
    // @ts-ignore
    return (obj[path[0]] = value);
  else if (path.length == 0) return obj;
  // @ts-ignore
  else return updateNestedProperty(obj[path[0]], path.slice(1), value);
}
