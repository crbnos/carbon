import type { Database } from "@carbon/database";
import type {
  purchaseInvoiceLineType,
  purchaseInvoiceStatusType,
} from "./invoicing.models";
import type {
  getPurchaseInvoiceDelivery,
  getPurchaseInvoiceLines,
  getPurchaseInvoices,
  getSalesInvoiceLines,
  getSalesInvoices,
  getSalesInvoiceShipment,
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

export type SalesInvoice = NonNullable<
  Awaited<ReturnType<typeof getSalesInvoices>>["data"]
>[number];

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
