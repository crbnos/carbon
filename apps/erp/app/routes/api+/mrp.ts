import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { runMRP } from "~/modules/production/production.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");

  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const result = await runMRP(getCarbonServiceRole(), {
    type: locationId ? "location" : "company",
    id: locationId ?? companyId,
    companyId,
    userId,
  });

  return json(result);
}
