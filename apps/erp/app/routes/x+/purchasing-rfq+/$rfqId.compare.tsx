import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSupplierQuotesForComparison } from "~/modules/purchasing";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "purchasing" });

  const { rfqId } = params;
  if (!rfqId) throw new Error("rfqId not found");

  const serviceRole = getCarbonServiceRole();
  const comparison = await getSupplierQuotesForComparison(serviceRole, rfqId);

  return {
    quotes: comparison.data?.quotes ?? [],
    lines: comparison.data?.lines ?? [],
    prices: comparison.data?.prices ?? []
  };
}
