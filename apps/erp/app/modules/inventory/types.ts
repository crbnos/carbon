import type { Database } from "@carbon/database";
import type {
  getBatchProperties,
  getInventoryItems,
  getItemLedgerPage,
  getReceiptLines,
  getReceiptTracking,
  getReceipts,
  getShipments,
  getShipmentLines,
  getShippingMethods,
  getShipmentLineTracking,
} from "./inventory.service";

export type BatchProperty = NonNullable<
  Awaited<ReturnType<typeof getBatchProperties>>["data"]
>[number];

export type InventoryItem = NonNullable<
  Awaited<ReturnType<typeof getInventoryItems>>["data"]
>[number];

export type ItemLedger = NonNullable<
  Awaited<ReturnType<typeof getItemLedgerPage>>["data"]
>[number];

export type ItemTracking = NonNullable<
  Awaited<ReturnType<typeof getReceiptTracking>>["data"]
>[number];

export type Receipt = NonNullable<
  Awaited<ReturnType<typeof getReceipts>>["data"]
>[number];

export type ReceiptLine = NonNullable<
  Awaited<ReturnType<typeof getReceiptLines>>["data"]
>[number];

export type ReceiptLineItem = Omit<
  ReceiptLine,
  "id" | "updatedBy" | "createdAt" | "updatedAt"
>;

export type ReceiptSourceDocument =
  Database["public"]["Enums"]["receiptSourceDocument"];

export type Shipment = NonNullable<
  Awaited<ReturnType<typeof getShipments>>["data"]
>[number];

export type ShipmentLine = NonNullable<
  Awaited<ReturnType<typeof getShipmentLines>>["data"]
>[number];

export type ShipmentLineTracking = NonNullable<
  Awaited<ReturnType<typeof getShipmentLineTracking>>["data"]
>[number];

export type ShippingCarrier = Database["public"]["Enums"]["shippingCarrier"];

export type ShippingMethod = NonNullable<
  Awaited<ReturnType<typeof getShippingMethods>>["data"]
>[number];

export type ShipmentSourceDocument =
  Database["public"]["Enums"]["shipmentSourceDocument"];
