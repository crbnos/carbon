// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The view-backed list endpoints select an explicit column list rather than
 * `*`, so Postgres can prune the views' unreferenced computed columns.
 *
 * TypeScript catches most under-selection, because the narrowed select narrows
 * the row type. It does NOT catch the CSV export path: `Table/components/
 * Download.tsx` reads `row[key]` for each column's `accessorKey`, untyped. A
 * column dropped from the select but still declared as an `accessorKey` would
 * export as blank with nothing failing.
 *
 * This test closes that gap: every accessorKey a list table declares must be a
 * column its endpoint actually selects.
 *
 * Known limitation: it does NOT cover `meta.exportValue` / `exportOnlyColumn`
 * functions, which read arbitrary row fields rather than a declared accessor
 * (e.g. PartsTable's `itemName` reads `row.name`). Those are correct today
 * because the column lists were derived by scanning whole table files, but a
 * future exportValue reading a dropped column would slip past this. Verify a
 * CSV export by hand when adding one.
 */

const ROOT = join(__dirname, "..");

type Target = {
  label: string;
  constant: string;
  service: string;
  table: string;
  /** The list's `X_PAGING` constant in the same service file. */
  paging: string;
};

const TARGETS: Target[] = [
  {
    label: "parts",
    constant: "PARTS_LIST_COLUMNS",
    paging: "PARTS_PAGING",
    service: "app/modules/items/items.service.ts",
    table: "app/modules/items/ui/Parts/PartsTable.tsx"
  },
  {
    label: "materials",
    constant: "MATERIALS_LIST_COLUMNS",
    paging: "MATERIALS_PAGING",
    service: "app/modules/items/items.service.ts",
    table: "app/modules/items/ui/Materials/MaterialsTable.tsx"
  },
  {
    label: "tools",
    constant: "TOOLS_LIST_COLUMNS",
    paging: "TOOLS_PAGING",
    service: "app/modules/items/items.service.ts",
    table: "app/modules/items/ui/Tools/ToolsTable.tsx"
  },
  {
    label: "consumables",
    constant: "CONSUMABLES_LIST_COLUMNS",
    paging: "CONSUMABLES_PAGING",
    service: "app/modules/items/items.service.ts",
    table: "app/modules/items/ui/Consumables/ConsumablesTable.tsx"
  },
  {
    label: "services",
    constant: "SERVICES_LIST_COLUMNS",
    paging: "SERVICES_PAGING",
    service: "app/modules/items/items.service.ts",
    table: "app/modules/items/ui/Services/ServicesTable.tsx"
  },
  {
    label: "purchaseOrders",
    constant: "PURCHASE_ORDERS_LIST_COLUMNS",
    paging: "PURCHASE_ORDERS_PAGING",
    service: "app/modules/purchasing/purchasing.service.ts",
    table: "app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx"
  },
  {
    label: "quotes",
    constant: "QUOTES_LIST_COLUMNS",
    paging: "QUOTES_PAGING",
    service: "app/modules/sales/sales.service.ts",
    table: "app/modules/sales/ui/Quotes/QuotesTable.tsx"
  },
  {
    label: "salesOrders",
    constant: "SALES_ORDERS_LIST_COLUMNS",
    paging: "SALES_ORDERS_PAGING",
    service: "app/modules/sales/sales.service.ts",
    table: "app/modules/sales/ui/SalesOrder/SalesOrdersTable.tsx"
  },
  {
    label: "purchaseInvoices",
    constant: "PURCHASE_INVOICES_LIST_COLUMNS",
    paging: "PURCHASE_INVOICES_PAGING",
    service: "app/modules/invoicing/invoicing.service.ts",
    table: "app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx"
  },
  {
    label: "salesInvoices",
    constant: "SALES_INVOICES_LIST_COLUMNS",
    paging: "SALES_INVOICES_PAGING",
    service: "app/modules/invoicing/invoicing.service.ts",
    table: "app/modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx"
  }
];

function selectedColumns(service: string, constant: string): string[] {
  const src = readFileSync(join(ROOT, service), "utf8");
  const match = src.match(
    new RegExp(`const ${constant} =\\s*\\n?\\s*"([^"]+)" as const;`)
  );
  if (!match) throw new Error(`${constant} not found in ${service}`);
  return match[1].split(",");
}

// A list whose explicit select is checked for its sort columns only: its
// table reads embedded records (`location.name`), not flat accessors.
const SORT_ONLY_TARGETS: Target[] = [
  {
    label: "fixedAssets",
    constant: "FIXED_ASSETS_LIST_COLUMNS",
    paging: "FIXED_ASSETS_PAGING",
    service: "app/modules/accounting/accounting.service.ts",
    table: "app/modules/accounting/ui/FixedAssets/FixedAssetsTable.tsx"
  }
];

/** The list-order columns of an `X_PAGING` constant (embedded-table sorts
 *  excluded), and its id column. */
function pagingColumns(service: string, paging: string): string[] {
  const src = readFileSync(join(ROOT, service), "utf8");
  const match = src.match(
    new RegExp(`export const ${paging}: Paging = \\{([\\s\\S]*?)\\};`)
  );
  if (!match) throw new Error(`${paging} not found in ${service}`);
  const sorts = [...match[1].matchAll(/\{([^{}]*)\}/g)]
    .map((m) => m[1])
    .filter((sort) => !sort.includes("foreignTable"))
    .map((sort) => sort.match(/column:\s*"([^"]+)"/)?.[1])
    .filter((column): column is string => Boolean(column));
  const idColumn = match[1].match(/idColumn:\s*"([^"]+)"/)?.[1] ?? "id";
  return [...sorts, idColumn];
}

function declaredAccessorKeys(table: string): string[] {
  const src = readFileSync(join(ROOT, table), "utf8");
  return [...src.matchAll(/accessorKey:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    // custom-field columns are keyed `customFields->>{id}` at runtime; the
    // `customFields` column itself is what has to be selected.
    .filter((key) => !key.startsWith("customFields->>"));
}

describe("list endpoints select every column their table exports", () => {
  it.each(TARGETS)(
    "$label",
    ({ constant, service, table }) => {
      const selected = new Set(selectedColumns(service, constant));
      const missing = declaredAccessorKeys(table).filter(
        (key) => !selected.has(key)
      );
      expect(
        missing,
        `${constant} is missing accessorKey(s) used by ${table}. These render ` +
          `blank in the CSV export, which nothing else catches.`
      ).toEqual([]);
    }
  );

  it("selects customFields wherever the table renders custom columns", () => {
    for (const { label, constant, service, table } of TARGETS) {
      const src = readFileSync(join(ROOT, table), "utf8");
      if (!src.includes("useCustomColumns")) continue;
      expect(
        selectedColumns(service, constant),
        `${label} renders custom columns but ${constant} omits customFields`
      ).toContain("customFields");
    }
  });
});

// `toPage` reads each sort column and the id from the last row of a page. A
// column missing from the select ends the list after page 1.
describe("list endpoints select the columns their cursor reads", () => {
  it.each([...TARGETS, ...SORT_ONLY_TARGETS])(
    "$label",
    ({ constant, service, paging }) => {
      const selected = new Set(selectedColumns(service, constant));
      const missing = pagingColumns(service, paging).filter(
        (column) => !selected.has(column)
      );
      expect(
        missing,
        `${constant} is missing the sort or id column(s) of ${paging}`
      ).toEqual([]);
    }
  );

  it("selects createdAt for fixed assets, a sort the URL can ask for", () => {
    expect(
      selectedColumns(
        "app/modules/accounting/accounting.service.ts",
        "FIXED_ASSETS_LIST_COLUMNS"
      )
    ).toContain("createdAt");
  });
});
