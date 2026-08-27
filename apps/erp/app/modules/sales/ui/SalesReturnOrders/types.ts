import type { Database } from "@carbon/database";
import type {
  getSalesReturnOrderCredits,
  getSalesReturnOrderIssues,
  getSalesReturnOrderLines,
  getSalesReturnOrderLineTrackedEntities,
  getSalesReturnOrderReceipts,
  getShippedTrackedEntitiesForCustomer
} from "../../sales.service";

export type SalesReturnOrder =
  Database["public"]["Tables"]["salesReturnOrder"]["Row"];

export type SalesReturnOrderListItem =
  Database["public"]["Views"]["salesReturnOrders"]["Row"];

export type SalesReturnOrderLine = NonNullable<
  Awaited<ReturnType<typeof getSalesReturnOrderLines>>["data"]
>[number];

export type SalesReturnOrderLineTrackedEntity = NonNullable<
  Awaited<ReturnType<typeof getSalesReturnOrderLineTrackedEntities>>["data"]
>[number];

export type SalesReturnOrderReceipt = NonNullable<
  Awaited<ReturnType<typeof getSalesReturnOrderReceipts>>["data"]
>[number];

export type SalesReturnOrderCredit = NonNullable<
  Awaited<ReturnType<typeof getSalesReturnOrderCredits>>["data"]
>[number];

export type SalesReturnOrderIssue = NonNullable<
  Awaited<ReturnType<typeof getSalesReturnOrderIssues>>["data"]
>[number];

export type ShippedTrackedEntity = NonNullable<
  Awaited<ReturnType<typeof getShippedTrackedEntitiesForCustomer>>["data"]
>[number];
