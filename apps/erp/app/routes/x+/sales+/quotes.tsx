// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { QuotesTable } from "~/modules/sales/ui/Quotes";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { quotesList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["quote"],
  breadcrumb: msg`Quotes`,
  to: path.to.quotes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, quotesList, {
    dataKey: "quotes",
    bypassRls: true,
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch quotes"
    }
  });
}

export default function QuotesRoute() {
  const { count, quotes, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <QuotesTable data={quotes} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
