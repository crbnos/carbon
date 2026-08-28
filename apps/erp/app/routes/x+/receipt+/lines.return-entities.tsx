import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import {
  getRepairOrderLineTrackedEntities,
  getSalesReturnOrderLineTrackedEntities
} from "~/modules/sales";

// Expected serials/batches for a receipt line that re-tags an EXISTING entity
// rather than minting a new serial — the picker source for ReturnEntityForm.
//
// Two documents feed it and their line ids live in different tables, so the
// caller passes `source`: an RMA line's picks, or the unit a repair line holds.
// Without that the repair leg silently returned zero expected entities and the
// picker fell through to standard serial entry, which then rejected the serial
// as already existing.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const lineId = url.searchParams.get("lineId");
  const receiptLineId = url.searchParams.get("receiptLineId");
  const source = url.searchParams.get("source");
  if (!lineId) {
    return { entities: [], assigned: [] };
  }

  const [expected, assigned] = await Promise.all([
    source === "Repair Order"
      ? getRepairOrderLineTrackedEntities(client, [lineId])
      : getSalesReturnOrderLineTrackedEntities(client, [lineId]),
    receiptLineId
      ? client
          .from("trackedEntity")
          .select("id, attributes")
          .eq("attributes ->> Receipt Line", receiptLineId)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [] })
  ]);

  return {
    entities: expected.data ?? [],
    assigned: assigned.data ?? []
  };
}
