// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

// A memo carries exactly one of customerId and supplierId: that, not its
// direction (Credit or Debit, on both pages), picks its page.
export const INVOICING_PAGES = [
  {
    id: "invoicing.payables",
    label: "Payables",
    maxLevel: "Create",
    tables: [],
    readers: ["purchaseInvoice"],
    paths: ["/x/invoicing/payables"]
  },
  {
    id: "invoicing.purchaseInvoices",
    label: "Purchase Invoices",
    maxLevel: "Full",
    tables: [
      "purchaseInvoice",
      "purchaseInvoiceLine",
      "purchaseInvoiceDelivery",
      "purchaseInvoicePriceChange",
      "purchaseInvoiceStatusHistory"
    ],
    readers: ["purchaseOrder"],
    paths: ["/x/invoicing/purchasing", "/x/purchase-invoice/"]
  },
  {
    id: "invoicing.supplierCredits",
    label: "Supplier Credits",
    maxLevel: "Full",
    tables: ["memo"],
    where: { table: "memo", column: "supplierId" },
    children: [{ table: "purchaseReturnOrderCreditLine", via: "memoId" }],
    paths: ["/x/invoicing/supplier-credits"]
  },
  {
    id: "invoicing.charges",
    label: "Charges",
    maxLevel: "Full",
    tables: ["charge", "chargeLine"],
    paths: ["/x/invoicing/charges"]
  },
  {
    id: "invoicing.reimbursements",
    label: "Reimbursements",
    maxLevel: "Full",
    tables: [
      "reimbursement",
      "reimbursementLine",
      "reimbursementLineDimension"
    ],
    paths: ["/x/invoicing/reimbursements", "/x/reimbursements/"]
  },
  {
    id: "invoicing.receivables",
    label: "Receivables",
    maxLevel: "Create",
    tables: [],
    readers: ["salesInvoice"],
    paths: ["/x/invoicing/receivables"]
  },
  {
    id: "invoicing.salesInvoices",
    label: "Sales Invoices",
    maxLevel: "Full",
    tables: ["salesInvoice", "salesInvoiceLine", "salesInvoiceShipment"],
    readers: ["salesOrder"],
    paths: ["/x/invoicing/sales", "/x/sales-invoice/"]
  },
  {
    id: "invoicing.creditMemos",
    label: "Credit Memos",
    maxLevel: "Full",
    tables: ["memo"],
    where: { table: "memo", column: "customerId" },
    children: [{ table: "salesReturnOrderCreditLine", via: "memoId" }],
    paths: ["/x/invoicing/credit-memos"]
  },
  {
    id: "invoicing.payments",
    label: "Payments",
    maxLevel: "Full",
    tables: ["payment", "invoiceSettlement"],
    paths: ["/x/invoicing/payments", "/x/payments/"]
  }
] as const satisfies readonly Page[];
