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

    // Sort picker stays keyed on string-header columns only, so JSX-header
    // columns (e.g. MRP week columns with a filterHeader) never flood it.
    if (accessorKey && stringHeader !== undefined) {
      const sortKey = column.meta?.sortBy ?? accessorKey;
      sortKeyToLabel[sortKey] = translate(stringHeader);
    }
  }

  return { accessors, exportValues, sortKeyToLabel };
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
