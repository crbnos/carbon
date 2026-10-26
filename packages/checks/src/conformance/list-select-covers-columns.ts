// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SourceFile, Violation } from "../check";

export const LIST_SELECT_COVERS_COLUMNS = "list-select-covers-columns";

const UI = "apps/erp/app/modules";

/**
 * The view-backed list endpoints select an explicit column list (so Postgres
 * prunes the views' unused computed columns), and each list table exports the
 * columns it declares. The narrowed select narrows the row type, but the CSV
 * export (`Table/components/Download.tsx`) reads `row[accessorKey]` untyped:
 * an accessorKey the select dropped exports blank, and nothing else fails.
 *
 * Each `*_LIST_COLUMNS` constant names the table that renders its rows.
 * Not covered: `meta.exportValue` / `exportOnlyColumn` read arbitrary fields.
 */
export const LIST_TABLES: Record<string, string> = {
  PARTS_LIST_COLUMNS: `${UI}/items/ui/Parts/PartsTable.tsx`,
  MATERIALS_LIST_COLUMNS: `${UI}/items/ui/Materials/MaterialsTable.tsx`,
  TOOLS_LIST_COLUMNS: `${UI}/items/ui/Tools/ToolsTable.tsx`,
  CONSUMABLES_LIST_COLUMNS: `${UI}/items/ui/Consumables/ConsumablesTable.tsx`,
  SERVICES_LIST_COLUMNS: `${UI}/items/ui/Services/ServicesTable.tsx`,
  PURCHASE_ORDERS_LIST_COLUMNS: `${UI}/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx`,
  QUOTES_LIST_COLUMNS: `${UI}/sales/ui/Quotes/QuotesTable.tsx`,
  SALES_ORDERS_LIST_COLUMNS: `${UI}/sales/ui/SalesOrder/SalesOrdersTable.tsx`,
  PURCHASE_INVOICES_LIST_COLUMNS: `${UI}/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx`,
  SALES_INVOICES_LIST_COLUMNS: `${UI}/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx`
};

const LIST_CONSTANT = /const ([A-Z_]+_LIST_COLUMNS) =\s*"([^"]*)"/g;

const lineAt = (contents: string, index = 0) =>
  contents.slice(0, index).split("\n").length;

/** Every list table's accessorKeys against the columns its endpoint selects. */
export function findUnselectedListColumns(
  services: SourceFile[],
  tables: SourceFile[]
): Violation[] {
  const out: Violation[] = [];
  const tableByFile = new Map(tables.map((t) => [t.file, t]));
  const found = new Set<string>();

  for (const service of services) {
    for (const match of service.contents.matchAll(LIST_CONSTANT)) {
      const [, constant = "", list = ""] = match;
      found.add(constant);
      const tablePath = LIST_TABLES[constant];
      const table = tablePath ? tableByFile.get(tablePath) : undefined;
      if (!table) {
        out.push({
          file: service.file,
          line: lineAt(service.contents, match.index),
          snippet: constant,
          message: tablePath
            ? `${tablePath} not found; update LIST_TABLES in list-select-covers-columns.ts`
            : `Add ${constant} and the table that renders it to LIST_TABLES in list-select-covers-columns.ts`
        });
        continue;
      }
      const selected = new Set(list.split(","));
      for (const key of table.contents.matchAll(/accessorKey:\s*"([^"]+)"/g)) {
        const column = key[1] ?? "";
        // Custom-field columns are keyed `customFields->>{id}`; the
        // `customFields` column itself is what has to be selected.
        if (column.startsWith("customFields->>") || selected.has(column))
          continue;
        out.push({
          file: table.file,
          line: lineAt(table.contents, key.index),
          snippet: `${constant} lacks ${column}`,
          message: `accessorKey "${column}" is not in ${constant}, so it exports blank in the CSV download`
        });
      }
      if (
        table.contents.includes("useCustomColumns") &&
        !selected.has("customFields")
      ) {
        out.push({
          file: table.file,
          line: lineAt(
            table.contents,
            table.contents.indexOf("useCustomColumns")
          ),
          snippet: `${constant} lacks customFields`,
          message: `The table renders custom columns but ${constant} does not select customFields`
        });
      }
    }
  }

  for (const constant of Object.keys(LIST_TABLES)) {
    if (found.has(constant)) continue;
    out.push({
      file: "packages/checks/src/conformance/list-select-covers-columns.ts",
      line: 0,
      snippet: constant,
      message: `${constant} is not defined in any module service; update LIST_TABLES`
    });
  }
  return out;
}
