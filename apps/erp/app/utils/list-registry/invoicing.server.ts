// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CHARGES_PAGING,
  getCharges,
  getMemos,
  getPayments,
  getPurchaseInvoices,
  getReimbursements,
  getSalesInvoices,
  MEMOS_PAGING,
  PAYMENTS_PAGING,
  PURCHASE_INVOICES_PAGING,
  REIMBURSEMENTS_PAGING,
  SALES_INVOICES_PAGING
} from "~/modules/invoicing/invoicing.service";
import type { Filter } from "../query";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

// The "Counterparty" column filter spans two columns (customerId OR
// supplierId), so the payments and memos lists take it out of the generic
// filters and hand it to the service, which applies it as an OR.
function splitCounterpartyFilter(filters: Filter[] = []) {
  const counterpartyIds = filters
    .filter((f) => f.column === "counterparty")
    .flatMap((f) => (f.value ?? "").split(","))
    .filter(Boolean);
  return {
    counterpartyIds: counterpartyIds.length > 0 ? counterpartyIds : null,
    filters: filters.filter((f) => f.column !== "counterparty")
  };
}

// The status filter of the payment, memo, charge and reimbursement lists.
type DocumentStatus = "Draft" | "Posted" | "Voided";

export const salesInvoicesList = searchList({
  key: "sales-invoices",
  permission: { view: "invoicing" },
  paging: SALES_INVOICES_PAGING,
  service: getSalesInvoices,
  params: { customerId: "customerId" }
});

export const purchaseInvoicesList = searchList({
  key: "purchase-invoices",
  permission: { view: "invoicing" },
  paging: PURCHASE_INVOICES_PAGING,
  service: getPurchaseInvoices,
  params: { supplierId: "supplierId" }
});

export const paymentsList = {
  key: "payments",
  permission: { view: "invoicing" },
  ...PAYMENTS_PAGING,
  query: (
    client,
    companyId,
    { params, limit, cursor, exactCount, sorts, filters }
  ) => {
    const split = splitCounterpartyFilter(filters);
    return getPayments(client, companyId, {
      search: params.get("search"),
      paymentType: params.get("paymentType") as
        | "Receipt"
        | "Disbursement"
        | null,
      status: params.get("status") as DocumentStatus | null,
      customerId: params.get("customerId"),
      supplierId: params.get("supplierId"),
      counterpartyIds: split.counterpartyIds,
      limit,
      cursor,
      exactCount,
      sorts,
      filters: split.filters
    });
  }
} satisfies ListDefinition;

// Accounts Receivable (customer memos) and Accounts Payable (supplier memos)
// read the same `memo` table, scoped by party.
function memosQuery(party: "customer" | "supplier") {
  return (
    ...[
      client,
      companyId,
      { params, limit, cursor, exactCount, sorts, filters }
    ]: Parameters<ListDefinition["query"]>
  ) => {
    const split = splitCounterpartyFilter(filters);
    return getMemos(client, companyId, {
      search: params.get("search"),
      direction: params.get("direction") as "Credit" | "Debit" | null,
      status: params.get("status") as DocumentStatus | null,
      party,
      counterpartyIds: split.counterpartyIds,
      limit,
      cursor,
      exactCount,
      sorts,
      filters: split.filters
    });
  };
}

export const creditMemosList = {
  key: "credit-memos",
  permission: { view: "invoicing" },
  ...MEMOS_PAGING,
  query: memosQuery("customer")
} satisfies ListDefinition;

export const supplierCreditsList = {
  key: "supplier-credits",
  permission: { view: "invoicing" },
  ...MEMOS_PAGING,
  query: memosQuery("supplier")
} satisfies ListDefinition;

export const chargesList = searchList({
  key: "charges",
  permission: { view: "invoicing" },
  paging: CHARGES_PAGING,
  service: getCharges,
  params: { type: "type", status: "status" }
});

export const reimbursementsList = searchList({
  key: "reimbursements",
  permission: { view: "invoicing" },
  paging: REIMBURSEMENTS_PAGING,
  service: getReimbursements,
  params: { status: "status", employeeId: "employeeId" }
});

// The invoicing lists. Each entry follows `sales.server.ts`.
export const invoicingLists: Record<string, ListDefinition> = {
  [salesInvoicesList.key]: salesInvoicesList,
  [purchaseInvoicesList.key]: purchaseInvoicesList,
  [paymentsList.key]: paymentsList,
  [creditMemosList.key]: creditMemosList,
  [supplierCreditsList.key]: supplierCreditsList,
  [chargesList.key]: chargesList,
  [reimbursementsList.key]: reimbursementsList
};
