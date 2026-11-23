// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  getSalesReturnOrderCredits,
  getSalesReturnOrderIssues,
  getSalesReturnOrderLineServiceJobs,
  getSalesReturnOrderLines,
  getSalesReturnOrderLineTrackedEntities,
  getSalesReturnOrderReceipts
} from "../../sales.service";

export type SalesReturnOrder =
  Database["public"]["Tables"]["salesReturnOrder"]["Row"];

export type SalesReturnOrderListItem =
  Database["public"]["Views"]["salesReturnOrders"]["Row"];

export type SalesReturnOrderLineServiceJob = NonNullable<
  Awaited<ReturnType<typeof getSalesReturnOrderLineServiceJobs>>["data"]
>[number];

/** A line as the RMA page loads it, with its service jobs. */
export type SalesReturnOrderLine = NonNullable<
  Awaited<ReturnType<typeof getSalesReturnOrderLines>>["data"]
>[number] & { serviceJob?: SalesReturnOrderLineServiceJob[] };

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
