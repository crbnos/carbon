import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getNoQuoteReasons } from "~/modules/sales/sales.service.server";
import { NoQuoteReasonsTable } from "~/modules/sales/ui/NoQuoteReasons";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`No Quote Reasons`,
  to: path.to.noQuoteReasons
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

  return await getNoQuoteReasons({
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function ScrapReasonsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <NoQuoteReasonsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
