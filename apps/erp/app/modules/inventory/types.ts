import type { Database } from "@carbon/database";
import type {
  getInventoryItems,
  getItemLedgerPage,
  getReceiptLines,
  getReceiptLineTracking,
  getReceipts,
  getShippingMethods,
} from "./inventory.service";

export type InventoryItem = NonNullable<
  Awaited<ReturnType<typeof getInventoryItems>>["data"]
>[number];

export type ItemLedger = NonNullable<
  Awaited<ReturnType<typeof getItemLedgerPage>>["data"]
>[number];

export type Receipt = NonNullable<
  Awaited<ReturnType<typeof getReceipts>>["data"]
>[number];

export type ReceiptLineTracking = NonNullable<
  Awaited<ReturnType<typeof getReceiptLineTracking>>["data"]
>[number];

export type ReceiptSourceDocument =
  Database["public"]["Enums"]["receiptSourceDocument"];

export type ReceiptLine = NonNullable<
  Awaited<ReturnType<typeof getReceiptLines>>["data"]
>[number];

export type ReceiptLineItem = Omit<
  ReceiptLine,
  "id" | "updatedBy" | "createdAt" | "updatedAt"
>;

export type ShippingCarrier = Database["public"]["Enums"]["shippingCarrier"];

export type ShippingMethod = NonNullable<
  Awaited<ReturnType<typeof getShippingMethods>>["data"]
>[number];
