// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SalesRFQsTable } from "~/modules/sales/ui/SalesRFQ";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { salesRfqsList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["salesRfq"],
  breadcrumb: msg`RFQs`,
  to: path.to.salesRfqs
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, salesRfqsList, {
    dataKey: "rfqs",
    bypassRls: true,
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch RFQs"
    }
  });
}

export default function RFQsRoute() {
  const { count, rfqs, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SalesRFQsTable data={rfqs} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
