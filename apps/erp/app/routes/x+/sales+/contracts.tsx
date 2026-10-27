// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ContractsTable } from "~/modules/sales/ui/Contracts";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { contractsList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Service Contracts`,
  to: path.to.contracts
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, contractsList, {
    dataKey: "contracts",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch contracts"
    }
  });
}

export default function ContractsRoute() {
  const { count, contracts, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ContractsTable data={contracts} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
