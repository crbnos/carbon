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
  const search = url.searchParams.get("search");
  const limitParam = Number(url.searchParams.get("limit"));
  const offsetParam = Number(url.searchParams.get("offset"));

  if (!supplierId) {
    return { lines: [], totalCount: 0 };
  }

  const result = await getReturnableLinesForSupplier(
    client,
    companyId,
    supplierId,
    {
      purchaseOrderId: purchaseOrderId ?? undefined,
      search: search ?? undefined,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 5,
      offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0
    }
  );

  if (result.error) {
    console.error("Failed to load returnable receipt lines:", result.error);
    return { lines: [], totalCount: 0 };
  }

  const lines = result.data ?? [];
  return { lines, totalCount: lines[0]?.totalCount ?? 0 };
}
