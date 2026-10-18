// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import GaugesTable from "~/modules/quality/ui/Gauge/GaugesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Gauges`,
  to: path.to.gauges
};

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const api = carbonFor(auth);

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [gauges, gaugeTypes] = await Promise.all([
    api.quality.getGauges({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.quality.getGaugeTypesList({})
  ]);

  return {
    gauges: gauges.data?.rows ?? [],
    count: gauges.data?.count ?? 0,
    gaugeTypes: gaugeTypes.data ?? []
  };
}

export default function GaugesRoute() {
  const { gauges, count, gaugeTypes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GaugesTable data={gauges} count={count} types={gaugeTypes} />
      <RecordOutlet />
    </VStack>
  );
}
