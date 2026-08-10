import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getDimensions } from "~/modules/accounting";
import { DimensionsTable } from "~/modules/accounting/ui/Dimensions";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Dimensions`,
  to: path.to.dimensions
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getDimensions(client, companyGroupId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function DimensionsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <DimensionsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
