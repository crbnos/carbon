import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSupplierQuotesForComparison } from "~/modules/purchasing";
import { requireCompanyRecord } from "~/modules/shared/shared.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("rfqId not found");

  const serviceRole = getCarbonServiceRole();

  // The comparison reads through the service role keyed on the URL's rfqId,
  // so the RFQ must belong to this company first.
  await requireCompanyRecord(serviceRole, "purchasingRfq", companyId, {
    id: rfqId
  });

  const comparison = await getSupplierQuotesForComparison(serviceRole, rfqId);

  return {
    quotes: comparison.data?.quotes ?? [],
    lines: comparison.data?.lines ?? [],
    prices: comparison.data?.prices ?? []
  };
}
