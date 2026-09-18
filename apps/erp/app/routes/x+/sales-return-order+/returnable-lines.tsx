import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getReturnableLinesForCustomer } from "~/modules/sales";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const salesOrderId = url.searchParams.get("salesOrderId");
  const search = url.searchParams.get("search");
  const limitParam = Number(url.searchParams.get("limit"));
  const offsetParam = Number(url.searchParams.get("offset"));

  if (!customerId) {
    return { lines: [], totalCount: 0 };
  }

  const result = await getReturnableLinesForCustomer(
    client,
    companyId,
    customerId,
    {
      salesOrderId: salesOrderId ?? undefined,
      search: search ?? undefined,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 5,
      offset: Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0
    }
  );

  if (result.error) {
    console.error("Failed to load returnable sales lines:", result.error);
    return { lines: [], totalCount: 0 };
  }

  const lines = result.data ?? [];
  return { lines, totalCount: lines[0]?.totalCount ?? 0 };
}
