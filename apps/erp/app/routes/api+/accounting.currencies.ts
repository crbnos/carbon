// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { getCurrenciesList } from "~/modules/accounting";
import { currenciesQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {});

  return await getCurrenciesList(client, companyGroupId);
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const query = currenciesQuery();
  const cache = window?.clientCache;
  if (!cache) return serverLoader<typeof loader>();

  // Every money cell mounts useCurrencies, so a grid fires dozens of these
  // loads at once. ensureQueryData shares one in-flight request between them;
  // a get-then-set let each concurrent load miss the cache and hit the server.
  return cache.ensureQueryData({
    queryKey: query.queryKey,
    queryFn: () => serverLoader<typeof loader>(),
    staleTime: query.staleTime
  });
}
clientLoader.hydrate = true;
