import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getPickedTrackedEntitiesForMaterial } from "~/services/inventory.service";

/**
 * The lots a picking list already picked for a job material — used to pre-select
 * the Issue modal when a picking allocation exists. `companyId` is derived from
 * the session, never trusted from the client.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const jobMaterialId = url.searchParams.get("jobMaterialId");

  if (!jobMaterialId) {
    return { data: [], error: null };
  }

  const data = await getPickedTrackedEntitiesForMaterial(client, {
    jobMaterialId,
    companyId
  });

  return { data, error: null };
}
