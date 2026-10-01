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
  const data = window?.clientCache?.getQueryData<typeof loader>(query.queryKey);

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(query.queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
