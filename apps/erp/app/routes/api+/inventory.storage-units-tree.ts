import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getStorageUnitsTreeForLocation } from "~/modules/inventory/inventory.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  if (!locationId) {
    return {
      data: [],
      error: null
    };
  }

  return await getStorageUnitsTreeForLocation(locationId);
}
