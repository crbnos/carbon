// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getShippedTrackedEntitiesForCustomer } from "~/modules/sales/sales.service";

const logger = getLogger("erp", "receipt", "return-entities");

// Candidate serials/batches for a sales-return receipt line — the picker
// source for return-receipt tracking (ReturnEntityForm). "Which serial is it"
// lives entirely on the receipt: candidates are every entity of the line's
// item shipped to this return's customer on a posted shipment, not a
// pre-picked list on the RMA. `lineId` is the RMA line id; `receiptLineId`
// additionally returns the entities currently assigned to that receipt line
// (attributes "Receipt Line").
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const lineId = url.searchParams.get("lineId");
  const receiptLineId = url.searchParams.get("receiptLineId");
  if (!lineId) {
    return { candidates: [], assigned: [], error: null };
  }

  const line = await client
    .from("salesReturnOrderLine")
    .select("itemId, salesReturnOrderId")
    .eq("id", lineId)
    .eq("companyId", companyId)
    .maybeSingle();

  const order = line.data?.salesReturnOrderId
    ? await client
        .from("salesReturnOrder")
        .select("customerId")
        .eq("id", line.data.salesReturnOrderId)
        .eq("companyId", companyId)
        .maybeSingle()
    : { data: null };

  const customerId = order.data?.customerId;
  const itemId = line.data?.itemId;

  const [candidates, assigned] = await Promise.all([
    customerId && itemId
      ? getShippedTrackedEntitiesForCustomer(
          client,
          companyId,
          customerId,
          itemId
        )
      : Promise.resolve({ data: [], error: null }),
    receiptLineId
      ? client
          .from("trackedEntity")
          .select("id, attributes")
          .eq("attributes ->> Receipt Line", receiptLineId)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [] })
  ]);

  const error =
    line.error ??
    ("error" in order ? order.error : null) ??
    candidates.error ??
    ("error" in assigned ? assigned.error : null);
  if (error) {
    logger.error("Failed to load return entities", {
      companyId,
      lineId,
      receiptLineId,
      error
    });
    return {
      candidates: [],
      assigned: [],
      error: "The returned units could not be loaded"
    };
  }

  return {
    candidates: candidates.data ?? [],
    assigned: assigned.data ?? [],
    error: null
  };
}
