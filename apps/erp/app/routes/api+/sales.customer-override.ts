import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCustomerItemPriceOverride } from "~/modules/sales/sales.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");
  const itemId = url.searchParams.get("itemId");

  if (!customerId || !itemId) {
    return data({ override: null });
  }

  const { data: override } = await getCustomerItemPriceOverride(
    customerId,
    itemId
  );

  return data({ override });
}
