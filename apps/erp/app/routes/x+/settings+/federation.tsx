// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  ApiKeysUpgradeOverlay,
  FederationRulesTable
} from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { federationRulesList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Identity Federation`,
  to: path.to.federationRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, federationRulesList, {
    dataKey: "federationRules",
    firstPage: ({ companyId }) => ({ companyId }),
    onError: {
      redirectTo: path.to.settings,
      message: "Failed to load federation rules"
    }
  });
}

export default function FederationRulesRoute() {
  const { federationRules, count, infinite } = useLoaderData<typeof loader>();
  // Federation mints API keys, so it shares their plan and upgrade pitch.
  const { isGated } = usePlanGate({ feature: "API_KEYS" });

  if (isGated) {
    return <ApiKeysUpgradeOverlay />;
  }
  return (
    <>
      <FederationRulesTable
        count={count}
        data={federationRules}
        infinite={infinite}
      />
      <RecordOutlet />
    </>
  );
}
