import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSerialNumbersForItem } from "~/modules/inventory/inventory.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId");
  if (!itemId) {
    return json({
      data: [],
      error: null,
    });
  }

  return json(
    await getSerialNumbersForItem(client, {
      itemId,
      companyId,
    })
  );
}
