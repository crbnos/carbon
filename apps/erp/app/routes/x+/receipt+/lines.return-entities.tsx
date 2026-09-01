import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getShippedTrackedEntitiesForCustomer } from "~/modules/sales";

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
    return { candidates: [], assigned: [] };
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

  return {
    candidates: candidates.data ?? [],
    assigned: assigned.data ?? []
  };
}
