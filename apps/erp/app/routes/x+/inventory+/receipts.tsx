// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ReceiptsTable } from "~/modules/inventory/ui";
import type { Handle } from "~/utils/handle";
import { receiptsList } from "~/utils/list-registry/inventory.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["receipt"],
  breadcrumb: msg`Receipts`,
  to: path.to.receipts
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, receiptsList, {
    dataKey: "receipts",
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Error loading receipts"
    }
  });
}

export default function ReceiptsRoute() {
  const { receipts, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReceiptsTable data={receipts} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
