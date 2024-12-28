import type { ColumnDef } from "@tanstack/react-table";

export function getAccessorKey<T>(columnDef: ColumnDef<T, unknown>) {
  return "accessorKey" in columnDef
    ? columnDef?.accessorKey.toString()
    : undefined;
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
