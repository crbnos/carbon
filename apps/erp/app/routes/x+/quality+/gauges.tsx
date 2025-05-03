import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getGauges, getGaugeTypesList } from "~/modules/quality";
import GaugesTable from "~/modules/quality/ui/Gauge/GaugesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Gauges",
  to: path.to.gauges,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [gauges, gaugeTypes] = await Promise.all([
    getGauges(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getGaugeTypesList(client, companyId),
  ]);

  return json({
    gauges: gauges.data ?? [],
    count: gauges.count ?? 0,
    types: gaugeTypes.data ?? [],
  });
}

export default function GaugesRoute() {
  const { gauges, count, types } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GaugesTable data={gauges} count={count} types={types} />
      <Outlet />
    </VStack>
  );
}
