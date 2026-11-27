// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { loadModules, modulesDir } from "../../sources/modules";
import { readIfPresent } from "../../sources/read-source";
import { lineOf } from "../../sources/text";

// The view-backed list endpoints select an explicit column list (so Postgres
// prunes the views' unused computed columns), and each list table exports the
// columns it declares. The narrowed select narrows the row type, but the CSV
// export (`Table/components/Download.tsx`) reads `row[accessorKey]` untyped:
// an accessorKey the select dropped exports blank, and nothing else fails.
// Not covered: `meta.exportValue` / `exportOnlyColumn` read arbitrary fields.
//
// Every constant must also select the columns its cursor reads: `toPage`
// reads each sort column of the list's `X_PAGING` and its id from the last
// row of a page, so a column missing from the select ends the list after
// page 1.
export const listSelectCoversColumns = defineCheck({
  id: "list-select-covers-columns",
  description:
    "Every list table's accessorKeys, and the columns its cursor reads, are in the columns its endpoint selects.",
  reads: {
    sources: (root) => {
      const ui = "apps/erp/app/modules";
      // Each `*_LIST_COLUMNS` constant and the table that renders its rows.
      const LIST_TABLES: Record<string, string> = {
        PARTS_LIST_COLUMNS: `${ui}/items/ui/Parts/PartsTable.tsx`,
        MATERIALS_LIST_COLUMNS: `${ui}/items/ui/Materials/MaterialsTable.tsx`,
        TOOLS_LIST_COLUMNS: `${ui}/items/ui/Tools/ToolsTable.tsx`,
        CONSUMABLES_LIST_COLUMNS: `${ui}/items/ui/Consumables/ConsumablesTable.tsx`,
        SERVICES_LIST_COLUMNS: `${ui}/items/ui/Services/ServicesTable.tsx`,
        PURCHASE_ORDERS_LIST_COLUMNS: `${ui}/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx`,
        QUOTES_LIST_COLUMNS: `${ui}/sales/ui/Quotes/QuotesTable.tsx`,
        SALES_ORDERS_LIST_COLUMNS: `${ui}/sales/ui/SalesOrder/SalesOrdersTable.tsx`,
        PURCHASE_INVOICES_LIST_COLUMNS: `${ui}/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx`,
        SALES_INVOICES_LIST_COLUMNS: `${ui}/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx`,
        CUSTOMERS_LIST_COLUMNS: `${ui}/sales/ui/Customers/CustomersTable.tsx`,
        SUPPLIERS_LIST_COLUMNS: `${ui}/purchasing/ui/Supplier/SuppliersTable.tsx`,
        CONTRACTS_LIST_COLUMNS: `${ui}/sales/ui/Contracts/ContractsTable.tsx`
      };
      return {
        listTables: LIST_TABLES,
        services: readIfPresent(
          root,
          loadModules(modulesDir(root)).map(
            ({ name }) => `${ui}/${name}/${name}.service.ts`
          )
        ),
        tables: readIfPresent(root, Object.values(LIST_TABLES))
      };
    }
  },
  rule() {
    const listConstant = /const ([A-Z_]+_LIST_COLUMNS) =\s*"([^"]*)"/g;

    /** The list-order columns of an `X_PAGING` constant (embedded-table sorts
     *  excluded) and its id column, or null when the service has no such constant. */
    const pagingColumns = (
      contents: string,
      paging: string
    ): string[] | null => {
      const match = contents.match(
        new RegExp(`export const ${paging}: Paging = \\{([\\s\\S]*?)\\};`)
      );
      if (!match) return null;
      const body = match[1] ?? "";
      const sorts = [...body.matchAll(/\{([^{}]*)\}/g)]
        .map((m) => m[1] ?? "")
        .filter((sort) => !sort.includes("foreignTable"))
        .map((sort) => sort.match(/column:\s*"([^"]+)"/)?.[1])
        .filter((column): column is string => Boolean(column));
      const idColumn = body.match(/idColumn:\s*"([^"]+)"/)?.[1] ?? "id";
      return [...sorts, idColumn];
    };

    return ({ sources }) => {
      const { listTables, services, tables } = sources;
      const out: Violation[] = [];
      const tableByFile = new Map(tables.map((t) => [t.file, t]));
      const found = new Set<string>();

      for (const service of services) {
        for (const match of service.contents.matchAll(listConstant)) {
          const [, constant = "", list = ""] = match;
          found.add(constant);
          const selected = new Set(list.split(","));
          const paging = `${constant.replace(/_LIST_COLUMNS$/, "")}_PAGING`;
          const cursorColumns = pagingColumns(service.contents, paging);
          if (!cursorColumns) {
            out.push({
              file: service.file,
              line: lineOf(service.contents, match.index),
              snippet: `${constant} has no ${paging}`,
              message: `${paging} not found beside ${constant}, so its cursor columns cannot be checked`
            });
          }
          for (const column of cursorColumns ?? []) {
            if (selected.has(column)) continue;
            out.push({
              file: service.file,
              line: lineOf(service.contents, match.index),
              snippet: `${constant} lacks cursor column ${column}`,
              message: `${paging} sorts or pages on "${column}" but ${constant} does not select it, so the list ends after page 1`
            });
          }
          // Checked for its cursor columns only: its table reads embedded records
          // (`location.name`), not flat accessors.
          if (constant === "FIXED_ASSETS_LIST_COLUMNS") continue;
          const tablePath = listTables[constant];
          const table = tablePath ? tableByFile.get(tablePath) : undefined;
          if (!table) {
            out.push({
              file: service.file,
              line: lineOf(service.contents, match.index),
              snippet: constant,
              message: tablePath
                ? `${tablePath} not found; update LIST_TABLES in list-select-covers-columns.ts`
                : `Add ${constant} and the table that renders it to LIST_TABLES in list-select-covers-columns.ts`
            });
            continue;
          }
          for (const key of table.contents.matchAll(
            /accessorKey:\s*"([^"]+)"/g
          )) {
            const column = key[1] ?? "";
            // Custom-field columns are keyed `customFields->>{id}`; the
            // `customFields` column itself is what has to be selected.
            if (column.startsWith("customFields->>") || selected.has(column))
              continue;
            out.push({
              file: table.file,
              line: lineOf(table.contents, key.index),
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
              line: lineOf(
                table.contents,
                table.contents.indexOf("useCustomColumns")
              ),
              snippet: `${constant} lacks customFields`,
              message: `The table renders custom columns but ${constant} does not select customFields`
            });
          }
        }
      }

      for (const constant of Object.keys(listTables)) {
        if (found.has(constant)) continue;
        out.push({
          file: "packages/checks/src/conformance/ui/list-select-covers-columns.ts",
          line: 0,
          snippet: constant,
          message: `${constant} is not defined in any module service; update LIST_TABLES`
        });
      }
      return out;
    };
  }
});
