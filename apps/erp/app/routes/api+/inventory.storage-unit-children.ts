// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    "inventory.storageUnits": "View"
  });

  const url = new URL(request.url);
  const parentId = url.searchParams.get("parentId");

  if (!parentId) {
    return { data: [], error: null };
  }

  const result = await api.inventory.getStorageUnitChildren({ parentId });

  if (result.error) {
    return { data: [], error: result.error };
  }

  return { data: result.data ?? [], error: null };
}
