// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type AgingRow = {
  customerId?: string;
  supplierId?: string;
  paymentTerm?: string | null;
  current: number;
  bucket1: number;
  bucket2: number;
  bucket3: number;
  bucket4: number;
  unapplied: number;
  total: number;
};

export type OpenInvoiceRow = {
  invoiceId: string;
  invoiceNumber: string;
  // 'Invoice' | 'Credit Memo' | 'Debit Memo' — from the open-by drill-down
  documentType?: string;
  transactionDate: string | null;
  dateDue: string | null;
  originalInBase: number;
  currencyCode: string;
  exchangeRate: number;
  totalAmount: number;
  settled: number;
  openInCurrency: number;
  openInBase: number;
  customerId?: string;
  supplierId?: string;
  supplierReference?: string | null;
};

export type OpenPaymentRow = {
  paymentId: string;
  paymentNumber: string;
  paymentType: string;
  transactionDate: string | null;
  originalInBase: number;
  openInBase: number;
  customerId?: string;
  supplierId?: string;
};

// A counterparty (root) row carries the aging buckets; an invoice (child) row
// carries the open amount. One union type so a single ColumnDef set can render
// both, branching on `kind` — the heterogeneous-tree analogue of the
// StorageUnit tree-table.
export type WorkbenchRow =
  | ({ kind: "counterparty"; id: string; partyId: string } & AgingRow)
  | ({ kind: "invoice"; id: string; partyId: string } & OpenInvoiceRow);
