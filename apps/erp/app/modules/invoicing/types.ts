import type {
  purchaseInvoiceLineType,
  purchaseInvoiceStatusType,
} from "./invoicing.models";
import type {
  getPurchaseInvoiceDelivery,
  getPurchaseInvoiceLines,
  getPurchaseInvoices,
} from "./invoicing.service";

export type PurchaseInvoice = NonNullable<
  Awaited<ReturnType<typeof getPurchaseInvoices>>["data"]
>[number];

export type PurchaseInvoiceDelivery = NonNullable<
  Awaited<ReturnType<typeof getPurchaseInvoiceDelivery>>["data"]
>;

export type PurchaseInvoiceLine = NonNullable<
  Awaited<ReturnType<typeof getPurchaseInvoiceLines>>["data"]
>[number];

export type PurchaseInvoiceLineType = (typeof purchaseInvoiceLineType)[number];

export type PurchaseInvoiceStatus = (typeof purchaseInvoiceStatusType)[number];
