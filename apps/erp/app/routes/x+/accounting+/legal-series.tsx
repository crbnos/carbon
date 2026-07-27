import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getLegalSeries } from "~/modules/accounting";
import { LegalSeriesTable } from "~/modules/accounting/ui/LegalSeries";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Legal Series`,
  to: path.to.legalSeries
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const legalSeries = await getLegalSeries(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (legalSeries.error) {
    throw new Error(legalSeries.error.message ?? "Failed to load legal series");
  }

  return legalSeries;
}

export default function LegalSeriesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <LegalSeriesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
