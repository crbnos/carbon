// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NoQuoteReasonsTable } from "~/modules/sales/ui/NoQuoteReasons";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { noQuoteReasonsList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`No Quote Reasons`,
  to: path.to.noQuoteReasons
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, noQuoteReasonsList, { dataKey: "data" });
}

export default function ScrapReasonsRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <NoQuoteReasonsTable data={data} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
