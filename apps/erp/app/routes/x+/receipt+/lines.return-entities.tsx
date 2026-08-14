import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSalesReturnOrderLineTrackedEntities } from "~/modules/sales";

// Expected serials/batches for a sales-return line — the picker source for
// return-receipt tracking (ReturnEntityForm). `lineId` is the RMA line id;
// `receiptLineId` additionally returns the entities currently assigned to
// that receipt line (attributes "Receipt Line").
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const lineId = url.searchParams.get("lineId");
  const receiptLineId = url.searchParams.get("receiptLineId");
  if (!lineId) {
    return { entities: [], assigned: [] };
  }

  const [expected, assigned] = await Promise.all([
    getSalesReturnOrderLineTrackedEntities(client, [lineId]),
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
