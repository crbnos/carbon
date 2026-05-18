import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getGauges, getGaugeTypesList } from "~/modules/quality";
import GaugesTable from "~/modules/quality/ui/Gauge/GaugesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Gauges`,
  to: path.to.gauges
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [gauges, gaugeTypes] = await Promise.all([
    getGauges({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getGaugeTypesList()
  ]);

  return {
    gauges: gauges.data ?? [],
    count: gauges.count ?? 0,
    gaugeTypes: gaugeTypes.data ?? []
  };
}

export default function GaugesRoute() {
  const { gauges, count, gaugeTypes } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GaugesTable data={gauges} count={count} types={gaugeTypes} />
      <Outlet />
    </VStack>
  );
}
