import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getRecipeProcessIdsForItem } from "~/modules/items/items.service.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  const { itemId } = params;
  if (!itemId) {
    return { data: [] as string[], error: null };
  }

  return await getRecipeProcessIdsForItem(itemId);
}
