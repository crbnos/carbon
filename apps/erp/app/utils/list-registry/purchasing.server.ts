// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { indexBy, indexByMapped, pluckUnique } from "@carbon/utils";
import {
  getLeases,
  getPurchaseOrders,
  getPurchaseReturnOrders,
  getPurchasingRFQs,
  getSupplierQuotes,
  getSupplierReportContacts,
  getSuppliers,
  getSupplierTypes,
  LEASES_PAGING,
  PURCHASE_ORDERS_PAGING,
  PURCHASE_RETURN_ORDERS_PAGING,
  PURCHASING_RFQS_PAGING,
  SUPPLIER_QUOTES_PAGING,
  SUPPLIER_TYPES_PAGING,
  SUPPLIERS_PAGING
} from "~/modules/purchasing/purchasing.service";
import type { SupplierReportContacts } from "~/modules/purchasing/types";
import { SUPPLIER_CONTACT_VALUES } from "~/modules/purchasing/ui/Supplier/supplier-list-export";
import type { ListDefinition, ListRowsContext } from "./index.server";
import { searchList } from "./index.server";

// The purchasing lists. Each entry follows `sales.server.ts`.
// Material Planning (`purchasing+/planning`) is not registered: its query
// needs the location the loader resolves from the user's defaults.

export const purchaseOrdersList = searchList({
  key: "purchase-orders",
  permission: { view: "purchasing" },
  paging: PURCHASE_ORDERS_PAGING,
  service: getPurchaseOrders,
  params: { status: "status", supplierId: "supplierId" }
});

export const supplierQuotesList = searchList({
  key: "supplier-quotes",
  permission: { view: "purchasing" },
  paging: SUPPLIER_QUOTES_PAGING,
  service: getSupplierQuotes
});

export const purchasingRfqsList = searchList({
  key: "purchasing-rfqs",
  permission: { view: "purchasing" },
  paging: PURCHASING_RFQS_PAGING,
  service: getPurchasingRFQs
});

export const purchaseReturnOrdersList = searchList({
  key: "purchase-return-orders",
  permission: { view: "purchasing" },
  paging: PURCHASE_RETURN_ORDERS_PAGING,
  service: getPurchaseReturnOrders,
  params: { status: "status", supplierId: "supplierId" }
});

export const supplierTypesList = {
  key: "supplier-types",
  permission: { view: "purchasing", role: "employee" },
  ...SUPPLIER_TYPES_PAGING,
  // The list has no column filters: the loader never passed them.
  query: (client, companyId, { params, limit, cursor, exactCount, sorts }) =>
    getSupplierTypes(client, companyId, {
      search: params.get("search"),
      limit,
      cursor,
      exactCount,
      sorts
    })
} satisfies ListDefinition;

/** The report contacts (purchasing, invoice, shipping) of each supplier: the
 *  suppliers view has none. */
export async function withSupplierReportContacts<
  T extends { id: string | null }
>(suppliers: T[], { client, companyId }: ListRowsContext) {
  const supplierIds = pluckUnique(suppliers, (s) => s.id);
  const [purchasingRes, paymentRes, shippingRes] =
    await getSupplierReportContacts(client, companyId, supplierIds);
  // A failed lookup fails the page: a blank contact column would read as
  // "none".
  for (const result of [purchasingRes, paymentRes, shippingRes]) {
    if (result.error) throw result.error;
  }

  const purchasingBySupplierId = indexByMapped(
    purchasingRes.data,
    (r) => r.id,
    (r) => r.purchasingContact
  );
  const paymentBySupplierId = indexBy(paymentRes.data, (r) => r.supplierId);
  const shippingBySupplierId = indexBy(shippingRes.data, (r) => r.supplierId);

  return suppliers.map((supplier) => {
    const reportContacts: SupplierReportContacts = {
      purchasingContact: purchasingBySupplierId.get(supplier.id!) ?? null,
      payment: paymentBySupplierId.get(supplier.id!) ?? null,
      shipping: shippingBySupplierId.get(supplier.id!) ?? null
    };
    return { ...supplier, reportContacts };
  });
}

export const suppliersList = searchList({
  key: "suppliers",
  permission: { view: "purchasing" },
  paging: SUPPLIERS_PAGING,
  service: getSuppliers,
  params: { type: "type", status: "status" },
  rows: withSupplierReportContacts,
  exportValues: SUPPLIER_CONTACT_VALUES
});

export const leasesList = searchList({
  key: "leases",
  permission: { view: "purchasing" },
  paging: LEASES_PAGING,
  service: getLeases
});

export const purchasingLists: Record<string, ListDefinition> = {
  [purchaseOrdersList.key]: purchaseOrdersList,
  [supplierQuotesList.key]: supplierQuotesList,
  [purchasingRfqsList.key]: purchasingRfqsList,
  [purchaseReturnOrdersList.key]: purchaseReturnOrdersList,
  [supplierTypesList.key]: supplierTypesList,
  [suppliersList.key]: suppliersList,
  [leasesList.key]: leasesList
};
