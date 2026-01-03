import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSerialNumbersForItem } from "~/services/inventory.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return {
      data: [],
      error: null
    };
  }

  const result = await getSerialNumbersForItem(client, {
    itemId,
    companyId
  });

  return result;
}
