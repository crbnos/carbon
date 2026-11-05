// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getIssueTypesList } from "~/modules/quality/quality.service";
import IssuesTable from "~/modules/quality/ui/Issue/IssuesTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { issuesList } from "~/utils/list-registry/quality.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["nonConformance"],
  breadcrumb: msg`Issues`,
  to: path.to.issues
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, issuesList, {
    dataKey: "issues",
    firstPage: async ({ client, companyId }) => ({
      types: (await getIssueTypesList(client, companyId)).data ?? []
    }),
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading issues"
    }
  });
}

export default function IssuesRoute() {
  const { issues, count, infinite, types } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <IssuesTable
        data={issues}
        count={count}
        infinite={infinite}
        types={types}
      />
      <RecordOutlet />
    </VStack>
  );
}
