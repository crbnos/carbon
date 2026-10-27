// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { ApiKeysTable, ApiKeysUpgradeOverlay } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { apiKeysList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`API Keys`,
  to: path.to.apiKeys
};

export async function loader({ request }: LoaderFunctionArgs) {
  // The registry query drops each key's hash.
  return loadListPage(request, apiKeysList, {
    dataKey: "apiKeys",
    firstPage: ({ companyId }) => ({ companyId }),
    onError: {
      redirectTo: path.to.settings,
      message: "Failed to load api keys"
    }
  });
}

export default function ApiKeysRoute() {
  const { apiKeys, count, infinite } = useLoaderData<typeof loader>();
  const { isGated } = usePlanGate({ feature: "API_KEYS" });

  if (isGated) {
    return <ApiKeysUpgradeOverlay />;
  }
  return (
    <>
      <ApiKeysTable count={count} data={apiKeys} infinite={infinite} />
      <RecordOutlet />
    </>
  );
}
