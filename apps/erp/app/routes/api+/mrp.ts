import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { runMRP } from "~/modules/production/production.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location");

  const { companyId } = await requirePermissions(request, {
    update: "inventory"
  });

  const result = await runMRP({
    type: locationId ? "location" : "company",
    id: locationId ?? companyId
  });

  return result;
}
