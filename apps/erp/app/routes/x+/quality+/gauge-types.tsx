// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import GaugeTypesTable from "~/modules/quality/ui/GaugeTypes/GaugeTypesTable";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { gaugeTypesList } from "~/utils/list-registry/quality.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Gauge Types`,
  to: path.to.gaugeTypes
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, gaugeTypesList, { dataKey: "data" });
}

export default function NonConformanceTypesRoute() {
  const { data, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GaugeTypesTable data={data} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
