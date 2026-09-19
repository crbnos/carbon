import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getItemStockQuantitiesByLocation } from "~/modules/items";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { locationId } = params;
  if (!locationId) throw new Error("Could not find locationId");

  return await getItemStockQuantitiesByLocation(client, companyId, locationId);
}
