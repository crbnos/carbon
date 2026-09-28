import type { Database } from "@carbon/database";
import type {
  getPurchaseReturnOrderCredits,
  getPurchaseReturnOrderIssues,
  getPurchaseReturnOrderLines,
  getPurchaseReturnOrderLineTrackedEntities,
  getPurchaseReturnOrderShipments,
  getReturnableEntitiesForSupplier
} from "../../purchasing.service";

export type PurchaseReturnOrder =
  Database["public"]["Tables"]["purchaseReturnOrder"]["Row"];

export type PurchaseReturnOrderListItem =
  Database["public"]["Views"]["purchaseReturnOrders"]["Row"];

export type PurchaseReturnOrderLine = NonNullable<
  Awaited<ReturnType<typeof getPurchaseReturnOrderLines>>["data"]
>[number];

export type PurchaseReturnOrderLineTrackedEntity = NonNullable<
  Awaited<ReturnType<typeof getPurchaseReturnOrderLineTrackedEntities>>["data"]
>[number];

export type PurchaseReturnOrderShipment = NonNullable<
  Awaited<ReturnType<typeof getPurchaseReturnOrderShipments>>["data"]
>[number];

export type PurchaseReturnOrderCredit = NonNullable<
  Awaited<ReturnType<typeof getPurchaseReturnOrderCredits>>["data"]
>[number];

export type PurchaseReturnOrderIssue = NonNullable<
  Awaited<ReturnType<typeof getPurchaseReturnOrderIssues>>["data"]
>[number];

export type ReturnableEntity = NonNullable<
  Awaited<ReturnType<typeof getReturnableEntitiesForSupplier>>["data"]
>[number];
