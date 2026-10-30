// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { FederationRulesTable } from "~/modules/settings/ui";
import { loadListPage } from "~/utils/list-registry/load.server";
import { federationRulesList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

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
