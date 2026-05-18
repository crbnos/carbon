import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getBatchNumbersForItem } from "~/modules/inventory/inventory.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return {
      data: [],
      error: null
    };
  }

  return await getBatchNumbersForItem({
    companyId,
    itemId
  });
}
