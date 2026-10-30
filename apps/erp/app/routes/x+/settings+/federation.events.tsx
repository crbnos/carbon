// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { FederationEventsTable } from "~/modules/settings/ui";
import { loadListPage } from "~/utils/list-registry/load.server";
import { federationExchangesList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, federationExchangesList, {
    dataKey: "federationExchanges",
    onError: {
      redirectTo: path.to.settings,
      message: "Failed to load authentication events"
    }
  });
}

export default function FederationEventsRoute() {
  const { federationExchanges, count, infinite } =
    useLoaderData<typeof loader>();
  return (
    <FederationEventsTable
      count={count}
      data={federationExchanges}
      infinite={infinite}
    />
  );
}
