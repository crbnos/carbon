// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getRecipeProcessIdsForItem } from "~/modules/items";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  const { itemId } = params;
  if (!itemId) {
    return { data: [] as string[], error: null };
  }

  return await getRecipeProcessIdsForItem(client, itemId);
}
