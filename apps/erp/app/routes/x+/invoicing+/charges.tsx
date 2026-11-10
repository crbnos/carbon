// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ChargesTable } from "~/modules/invoicing/ui";
import type { Handle } from "~/utils/handle";
import { chargesList } from "~/utils/list-registry/invoicing.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Charges`,
  to: path.to.charges,
  module: "invoicing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, chargesList, {
    dataKey: "data",
    onError: {
      redirectTo: path.to.invoicing,
      message: "Failed to fetch charges"
    }
  });
}

export default function ChargesRoute() {
  const { count, data, infinite } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <ChargesTable data={data} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
