// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  getIssueTypesList,
  getRequiredActionsList
} from "~/modules/quality/quality.service";
import ActionsTable from "~/modules/quality/ui/Actions/ActionsTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { qualityActionsList } from "~/utils/list-registry/quality.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Actions`,
  to: path.to.qualityActions
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, qualityActionsList, {
    dataKey: "actions",
    firstPage: async ({ client, companyId }) => {
      const [issueTypes, requiredActions] = await Promise.all([
        getIssueTypesList(client, companyId),
        getRequiredActionsList(client, companyId)
      ]);
      return {
        issueTypes: issueTypes.data ?? [],
        requiredActions: requiredActions.data ?? []
      };
    }
  });
}

export default function ActionsRoute() {
  const { actions, count, infinite, issueTypes, requiredActions } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ActionsTable
        data={actions}
        count={count}
        infinite={infinite}
        issueTypes={issueTypes}
        requiredActions={requiredActions}
      />
      <RecordOutlet />
    </VStack>
  );
}
