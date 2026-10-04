// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getUnitOfMeasuresList } from "~/modules/items";
import { cachedClientLoader, RefreshRate } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return await getUnitOfMeasuresList(client, companyId);
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.Medium
});
