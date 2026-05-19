import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSerialNumbersForItem } from "~/modules/inventory/inventory.service";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return {
      data: [],
      error: null
    };
  }

  return await getSerialNumbersForItem({ itemId });
}
