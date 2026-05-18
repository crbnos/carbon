import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getGaugeTypes } from "~/modules/quality";
import GaugeTypesTable from "~/modules/quality/ui/GaugeTypes/GaugeTypesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Gauge Types`,
  to: path.to.gaugeTypes
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

  return await getGaugeTypes({
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function NonConformanceTypesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GaugeTypesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
