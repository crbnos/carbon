import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { runMRP } from "~/modules/production/production.service";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");

  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const result = await runMRP(getCarbonServiceRole(), getDatabaseClient(), {
    type: locationId ? "location" : "company",
    id: locationId ?? companyId,
    companyId,
    userId
  });

  return result;
}
