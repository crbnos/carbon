// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { cachedClientLoader, RefreshRate } from "@carbon/query/cache";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request);

  return await api.items.getUnitOfMeasuresList({});
}

export const clientLoader = cachedClientLoader<typeof loader>({
  staleTime: RefreshRate.Medium
});
