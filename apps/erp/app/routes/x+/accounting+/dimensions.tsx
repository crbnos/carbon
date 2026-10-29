// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DimensionsTable } from "~/modules/accounting/ui/Dimensions";
import type { Handle } from "~/utils/handle";
import { dimensionsList } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Dimensions`,
  to: path.to.dimensions
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, dimensionsList, { dataKey: "data" });
}

export default function DimensionsRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <DimensionsTable data={data} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
