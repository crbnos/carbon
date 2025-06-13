import { assertIsPost, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { runMRP } from "~/modules/production/production.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const result = await runMRP(getCarbonServiceRole(), {
    type: "company",
    id: companyId,
    companyId,
    userId,
  });

  return json(result);
}
