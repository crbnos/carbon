// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ReturnReasonsTable } from "~/modules/sales/ui/ReturnReasons";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { returnReasonsList } from "~/utils/list-registry/sales.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Return Reasons`,
  to: path.to.returnReasons
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, returnReasonsList, { dataKey: "data" });
}

export default function ReturnReasonsRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ReturnReasonsTable data={data} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
