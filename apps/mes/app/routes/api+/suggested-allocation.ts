import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSuggestedAllocationForMaterial } from "~/services/inventory.service";

/**
 * On-the-fly batch/lot suggestion for issuing a tracked material with no picking
 * list linked — the same allocation the picking list would compute, per material.
 * `companyId` is derived from the session, never trusted from the client.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  const locationId = url.searchParams.get("locationId");
  const quantity = Number(url.searchParams.get("quantity") ?? "0");

  if (!itemId || !locationId || !Number.isFinite(quantity) || quantity <= 0) {
    return { data: [], error: null };
  }

  const data = await getSuggestedAllocationForMaterial(client, {
    itemId,
    companyId,
    locationId,
    quantity
  });

  return { data, error: null };
}
