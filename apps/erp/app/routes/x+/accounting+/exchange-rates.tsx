import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getCurrencies } from "~/modules/accounting";
import { ExchangeRatesTable } from "~/modules/accounting/ui/ExchangeRates";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Exchange Rates`,
  to: path.to.exchangeRates
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getCurrencies(companyGroupId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function ExchangeRatesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ExchangeRatesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
