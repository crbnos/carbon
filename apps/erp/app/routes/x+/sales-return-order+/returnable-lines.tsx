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

  if (!customerId) {
    return { lines: [] };
  }

  const result = await getReturnableLinesForCustomer(
    client,
    companyId,
    customerId,
    salesOrderId ? { salesOrderId } : undefined
  );

  if (result.error) {
    return { lines: [] };
  }

  return { lines: result.data ?? [] };
}
