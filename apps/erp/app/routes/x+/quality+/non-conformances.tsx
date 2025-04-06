import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  getNonConformances,
  getNonConformanceTypesList,
} from "~/modules/quality";
import NonConformancesTable from "~/modules/quality/ui/NonConformance/NonConformancesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Non-Conformances",
  to: path.to.nonConformances,
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

  const [nonConformances, nonConformanceTypes] = await Promise.all([
    getNonConformances(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getNonConformanceTypesList(client, companyId),
  ]);

  return json({
    nonConformances: nonConformances.data ?? [],
    count: nonConformances.count ?? 0,
    types: nonConformanceTypes.data ?? [],
  });
}

export default function NonConformancesRoute() {
  const { nonConformances, count, types } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <NonConformancesTable
        data={nonConformances}
        count={count}
        types={types}
      />
      <Outlet />
    </VStack>
  );
}
