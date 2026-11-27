// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readIfPresent } from "./cross-file";
import { loadModules, modulesDir } from "./modules";

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
 *
 * Every constant must also select the columns its cursor reads: `toPage`
 * reads each sort column of the list's `X_PAGING` and its id from the last
 * row of a page, so a column missing from the select ends the list after
 * page 1.
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
  SALES_INVOICES_LIST_COLUMNS: `${UI}/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx`,
  CUSTOMERS_LIST_COLUMNS: `${UI}/sales/ui/Customers/CustomersTable.tsx`,
  SUPPLIERS_LIST_COLUMNS: `${UI}/purchasing/ui/Supplier/SuppliersTable.tsx`,
  CONTRACTS_LIST_COLUMNS: `${UI}/sales/ui/Contracts/ContractsTable.tsx`
};

/** Every module's `<m>.service.ts`, and the list tables `LIST_TABLES` names. */
export function loadListSources(root: string) {
  return {
    services: readIfPresent(
      root,
      loadModules(modulesDir(root)).map(
        ({ name }) => `apps/erp/app/modules/${name}/${name}.service.ts`
      )
    ),
    tables: readIfPresent(root, Object.values(LIST_TABLES))
  };
}
