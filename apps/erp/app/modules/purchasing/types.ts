import type { Database } from "@carbon/database";
import type { FileObject } from "@supabase/storage-js";
import type {
  getPurchaseOrderDelivery,
  getPurchaseOrderLines,
  getPurchaseOrders,
  getPurchasingPlanning,
  getPurchasingRFQLines,
  getPurchasingRFQSuppliers,
  getPurchasingRFQs,
  getSupplier,
  getSupplierContacts,
  getSupplierInteraction,
  getSupplierLocations,
  getSupplierProcessesBySupplier,
  getSupplierQuoteLinePricesByQuoteId,
  getSupplierQuoteLines,
  getSupplierQuotes,
  getSupplierReportContacts,
  getSuppliers,
  getSupplierTypes
} from "./purchasing.service";

export type PurchaseOrderAttachment = FileObject; // TODO: remove

// The `X`/`XListItem` pairs below are deliberately separate: `X` is the full
// view row that detail screens read, `XListItem` is exactly what the list
// query selects. Defining `X` from the list getter is what broke ~250 call
// sites when the list selects were narrowed.
export type PurchaseOrder =
  Database["public"]["Views"]["purchaseOrders"]["Row"];

export type PurchaseOrderListItem = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrders>>["data"]
>[number];

export type PurchaseOrderDelivery = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrderDelivery>>["data"]
>;

export type PurchaseOrderLine = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrderLines>>["data"]
>[number];

export type PurchaseOrderLineType =
  Database["public"]["Enums"]["purchaseOrderLineType"];

export type PurchaseOrderStatus =
  Database["public"]["Enums"]["purchaseOrderStatus"];

export type PurchaseOrderType =
  Database["public"]["Enums"]["purchaseOrderType"];

export type PurchaseOrderTransactionType =
  Database["public"]["Enums"]["purchaseOrderTransactionType"];

export type PurchasingPlanningItem = NonNullable<
  Awaited<ReturnType<typeof getPurchasingPlanning>>["data"]
>[number];

export type PurchasingRFQ = NonNullable<
  Awaited<ReturnType<typeof getPurchasingRFQs>>["data"]
>[number];

export type PurchasingRFQLine = NonNullable<
  Awaited<ReturnType<typeof getPurchasingRFQLines>>["data"]
>[number];

export type PurchasingRFQSupplier = NonNullable<
  Awaited<ReturnType<typeof getPurchasingRFQSuppliers>>["data"]
>[number];

export type PurchasingRFQStatusType =
  Database["public"]["Enums"]["purchasingRfqStatus"];

export type Supplier = NonNullable<
  Awaited<ReturnType<typeof getSuppliers>>["data"]
>[number];

export type SupplierDetail = NonNullable<
  Awaited<ReturnType<typeof getSupplier>>["data"]
>;

export type SupplierContact = NonNullable<
  Awaited<ReturnType<typeof getSupplierContacts>>["data"]
>[number];

// Element types of each of the 3 parallel queries in getSupplierReportContacts,
// keyed by supplier id / supplierId. Used to type the per-supplier report-contact
// map built in the suppliers.tsx loader and consumed by SuppliersTable's CSV
// export-only columns.
type SupplierReportContactsResult = Awaited<
  ReturnType<typeof getSupplierReportContacts>
>;
export type SupplierPurchasingContact = NonNullable<
  SupplierReportContactsResult[0]["data"]
>[number]["purchasingContact"];
export type SupplierPaymentContact = NonNullable<
  SupplierReportContactsResult[1]["data"]
>[number];
export type SupplierShippingContact = NonNullable<
  SupplierReportContactsResult[2]["data"]
>[number];

export type SupplierReportContactsBySupplierId = Record<
  string,
  {
    purchasingContact: SupplierPurchasingContact | null;
    payment: SupplierPaymentContact | null;
    shipping: SupplierShippingContact | null;
  }
>;

export type SupplierInteraction = NonNullable<
  Awaited<ReturnType<typeof getSupplierInteraction>>["data"]
>;

export type SupplierLocation = NonNullable<
  Awaited<ReturnType<typeof getSupplierLocations>>["data"]
>[number];

export type SupplierProcess = NonNullable<
  Awaited<ReturnType<typeof getSupplierProcessesBySupplier>>["data"]
>[number];

export type SupplierQuote = NonNullable<
  Awaited<ReturnType<typeof getSupplierQuotes>>["data"]
>[number];

export type SupplierQuoteLine = NonNullable<
  Awaited<ReturnType<typeof getSupplierQuoteLines>>["data"]
>[number];

export type SupplierQuoteLinePrice = NonNullable<
  Awaited<ReturnType<typeof getSupplierQuoteLinePricesByQuoteId>>["data"]
>[number];

export type SupplierType = NonNullable<
  Awaited<ReturnType<typeof getSupplierTypes>>["data"]
>[number];
