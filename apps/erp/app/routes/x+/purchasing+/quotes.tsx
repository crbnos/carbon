// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SupplierQuotesTable } from "~/modules/purchasing/ui/SupplierQuote";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { supplierQuotesList } from "~/utils/list-registry/purchasing.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["supplierQuote"],
  breadcrumb: msg`Supplier Quotes`,
  to: path.to.supplierQuotes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, supplierQuotesList, {
    dataKey: "quotes",
    bypassRls: true,
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch quotes"
    }
  });
}

export default function SupplierQuotesRoute() {
  const { count, quotes, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SupplierQuotesTable data={quotes} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
