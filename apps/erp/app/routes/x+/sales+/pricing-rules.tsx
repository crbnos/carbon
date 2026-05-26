import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getPricingRules } from "~/modules/sales/sales.service.server";
import PricingRulesTable from "~/modules/sales/ui/Pricing/PricingRulesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Pricing Rules",
  to: path.to.salesPricingRules
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getPricingRules({
    search: search ?? undefined,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function PricingRulesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PricingRulesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
