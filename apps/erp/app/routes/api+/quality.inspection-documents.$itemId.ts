// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { cachedClientLoader } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "quality"
  });

  const { itemId } = params;
  if (!itemId) {
    return data({ error: "Item ID is required" }, { status: 400 });
  }

  return await api.quality.getInspectionDocumentsForItem({ itemId });
}

export const clientLoader = cachedClientLoader<typeof loader>();
