import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getStorageUnitsTreeForLocation } from "~/modules/inventory";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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

  return await getStorageUnitsTreeForLocation(client, companyId, locationId);
}
