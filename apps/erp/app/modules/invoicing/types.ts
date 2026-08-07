import type { Database } from "@carbon/database";
import type {
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
>[number];

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
