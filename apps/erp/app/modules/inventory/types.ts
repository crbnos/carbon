import type { Database } from "@carbon/database";
import type {
  getBatchProperties,
  getInventoryItems,
  getItemLedgerPage,
  getKanbans,
  getReceiptLines,
  getReceiptTracking,
  getReceipts,
  getShipmentLines,
  getShipmentTracking,
  getShipments,
  getShippingMethods,
  getTrackedEntities,
  getWarehouseTransferLines,
  getWarehouseTransfers,
} from "./inventory.service";

export type BatchProperty = NonNullable<
  Awaited<ReturnType<typeof getBatchProperties>>["data"]
>[number];

export type Kanban = NonNullable<
  Awaited<ReturnType<typeof getKanbans>>["data"]
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
  Awaited<ReturnType<typeof getShipmentTracking>>["data"]
>[number];

export type ShippingCarrier = Database["public"]["Enums"]["shippingCarrier"];

export type ShippingMethod = NonNullable<
  Awaited<ReturnType<typeof getShippingMethods>>["data"]
>[number];

export type ShipmentSourceDocument =
  Database["public"]["Enums"]["shipmentSourceDocument"];

export type TrackedEntity = NonNullable<
  Awaited<ReturnType<typeof getTrackedEntities>>["data"]
>[number];

export type WarehouseTransfer = NonNullable<
  Awaited<ReturnType<typeof getWarehouseTransfers>>["data"]
>[number];

export type WarehouseTransferLine = NonNullable<
  Awaited<ReturnType<typeof getWarehouseTransferLines>>["data"]
>[number];

export interface Activity {
  id: string;
  type: string;
  sourceDocument?: string;
  sourceDocumentId?: string;
  sourceDocumentReadableId?: string;
  attributes: Record<string, any>;
}

export interface ActivityInput {
  trackedActivityId: string;
  trackedEntityId: string;
  quantity: number;
}

export interface ActivityOutput {
  trackedActivityId: string;
  trackedEntityId: string;
  quantity: number;
}

export interface GraphNode {
  id: string;
  type: "entity" | "activity";
  data: TrackedEntity | Activity;
  x?: number;
  y?: number;
  depth?: number;
  parentId: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  type: "input" | "output";
  quantity: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
