// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import type { LoaderFunctionArgs } from "react-router";
import { getRecipeProcessIdsForItem } from "~/modules/items/items.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await authorize(request, {});
  const { itemId } = params;
  if (!itemId) {
    return { data: [] as string[], error: null };
  }

  return await getRecipeProcessIdsForItem(client, itemId);
}
