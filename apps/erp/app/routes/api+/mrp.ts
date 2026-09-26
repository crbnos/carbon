import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { runMRP } from "~/modules/production/production.service";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");

  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const serviceRole = getCarbonServiceRole();

  // The location id comes from the query string and MRP runs with the service
  // role + Kysely, so confirm it belongs to this company first.
  if (locationId) {
    await requireCompanyRecord(serviceRole, "location", companyId, {
      id: locationId
    });
  }

  const result = await runMRP(serviceRole, getDatabaseClient(), {
    type: locationId ? "location" : "company",
    id: locationId ?? companyId,
    companyId,
    userId
  });

  return result;
}
