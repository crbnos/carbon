import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getReturnableLinesForSupplier } from "~/modules/purchasing";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplierId");
  const purchaseOrderId = url.searchParams.get("purchaseOrderId");

  if (!supplierId) {
    return { lines: [] };
  }

  const result = await getReturnableLinesForSupplier(
    client,
    companyId,
    supplierId,
    purchaseOrderId ? { purchaseOrderId } : undefined
  );

  if (result.error) {
    return { lines: [] };
  }

  return { lines: result.data ?? [] };
}
