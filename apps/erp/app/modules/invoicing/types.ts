// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  PaymentRequestStatus,
  purchaseInvoiceLineType,
  purchaseInvoiceStatusType
} from "./invoicing.models";
import type {
  getPurchaseInvoiceDelivery,
  getPurchaseInvoiceLines,
  getPurchaseInvoices,
  getSalesInvoiceLines,
  getSalesInvoiceShipment,
  getSalesInvoices
} from "./invoicing.service";

export type PurchaseInvoice =
  Database["public"]["Views"]["purchaseInvoices"]["Row"];

export type PurchaseInvoiceListItem = NonNullable<
  Awaited<ReturnType<typeof getPurchaseInvoices>>["data"]
>[number] & {
  glCodes?: string | null;
};

export type PurchaseInvoiceDelivery = NonNullable<
  Awaited<ReturnType<typeof getPurchaseInvoiceDelivery>>["data"]
>;

export type PurchaseInvoiceLine = NonNullable<
  Awaited<ReturnType<typeof getPurchaseInvoiceLines>>["data"]
>[number];

export type PurchaseInvoiceLineType = (typeof purchaseInvoiceLineType)[number];

export type PurchaseInvoiceStatus = (typeof purchaseInvoiceStatusType)[number];

// The `X`/`XListItem` pairs below are deliberately separate: `X` is the full
// view row that detail screens read, `XListItem` is exactly what the list
// query selects. Defining `X` from the list getter is what broke ~250 call
// sites when the list selects were narrowed.
export type SalesInvoice = Database["public"]["Views"]["salesInvoices"]["Row"];

export type SalesInvoiceListItem = NonNullable<
  Awaited<ReturnType<typeof getSalesInvoices>>["data"]
>[number] & {
  glCodes?: string | null;
};

export type SalesInvoiceShipment = NonNullable<
  Awaited<ReturnType<typeof getSalesInvoiceShipment>>["data"]
>;

export type SalesInvoiceLine = NonNullable<
  Awaited<ReturnType<typeof getSalesInvoiceLines>>["data"]
>[number];

export type SalesInvoiceLineType =
  Database["public"]["Enums"]["salesInvoiceLineType"];

export type SalesInvoiceStatus =
  Database["public"]["Enums"]["salesInvoiceStatus"];

export type PaymentRequestRow = {
  id: string;
  requestNumber: number;
  status: PaymentRequestStatus;
  amount: string | number | null;
  dueDate: string | null;
  description: string | null;
  isAutomatic: boolean;
  paymentId: string | null;
};

/** What `getPaymentRequestsForDocument` returns. The card computes none of it. */
export type PaymentRequestsData = {
  requests: PaymentRequestRow[];
  openBalance: number;
  requested: number;
  planned: number;
  allowance: number;
};

export type PaymentRequestTarget =
  | { purchaseInvoiceId: string }
  | { purchaseOrderId: string };
