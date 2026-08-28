import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getWarrantyRegistrations } from "~/modules/sales";
import { WarrantyRegistrationsTable } from "~/modules/sales/ui/Warranties";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Warranties`,
  to: path.to.warrantyRegistrations
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const customerId = searchParams.get("customerId");
  const itemId = searchParams.get("itemId");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  return await getWarrantyRegistrations(client, companyId, {
    search,
    customerId,
    itemId,
    limit,
    offset,
    sorts,
    filters
  });
}

export default function WarrantyRegistrationsRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <WarrantyRegistrationsTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
