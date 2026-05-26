import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSupplierPartPriceBreaks } from "~/modules/items/items.service.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierPartId } = params;
  if (!supplierPartId) {
    return [];
  }

  return await getSupplierPartPriceBreaks(supplierPartId);
}
