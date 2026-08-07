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

// The full `purchaseInvoices` view row. Detail screens (Properties/Summary/Header/LineForm)
// use this, so it must stay independent of whatever subset the LIST query selects
// — see PurchaseInvoiceListItem.
export type PurchaseInvoice =
  Database["public"]["Views"]["purchaseInvoices"]["Row"];

// A row of the purchaseInvoices LIST, i.e. exactly the columns `getPurchaseInvoices` selects.
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

// The full `salesInvoices` view row. Detail screens (Properties/Summary/Header/LineForm)
// use this, so it must stay independent of whatever subset the LIST query selects
// — see SalesInvoiceListItem.
export type SalesInvoice = Database["public"]["Views"]["salesInvoices"]["Row"];

// A row of the salesInvoices LIST, i.e. exactly the columns `getSalesInvoices` selects.
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
