import type { Database } from "@carbon/database";
import type {
  getPurchaseOrderExternalDocuments,
  getPurchaseOrderLines,
  getPurchaseOrders,
  getSupplier,
  getSupplierContacts,
  getSupplierLocations,
  getSupplierProcessesBySupplier,
  getSupplierQuotes,
  getSuppliers,
  getSupplierStatuses,
  getSupplierTypes,
} from "./purchasing.service";

// TODO: we should just use the FileObject type from supabase
export type PurchaseOrderAttachment = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrderExternalDocuments>>
>[number];

export type PurchaseOrder = NonNullable<
  Awaited<ReturnType<typeof getPurchaseOrders>>["data"]
>[number];

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

export type Supplier = NonNullable<
  Awaited<ReturnType<typeof getSuppliers>>["data"]
>[number];

export type SupplierDetail = NonNullable<
  Awaited<ReturnType<typeof getSupplier>>["data"]
>;

export type SupplierContact = NonNullable<
  Awaited<ReturnType<typeof getSupplierContacts>>["data"]
>[number];

export type SupplierLocation = NonNullable<
  Awaited<ReturnType<typeof getSupplierLocations>>["data"]
>[number];

export type SupplierProcess = NonNullable<
  Awaited<ReturnType<typeof getSupplierProcessesBySupplier>>["data"]
>[number];

export type SupplierQuote = NonNullable<
  Awaited<ReturnType<typeof getSupplierQuotes>>["data"]
>[number];

export type SupplierStatus = NonNullable<
  Awaited<ReturnType<typeof getSupplierStatuses>>["data"]
>[number];

export type SupplierType = NonNullable<
  Awaited<ReturnType<typeof getSupplierTypes>>["data"]
>[number];
