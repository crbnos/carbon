import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getSupplierTypes } from "~/modules/purchasing/purchasing.service.server";
import { SupplierTypesTable } from "~/modules/purchasing/ui/SupplierTypes";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Supplier Types`,
  to: path.to.supplierTypes
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts } = getGenericQueryFilters(searchParams);

  return await getSupplierTypes({
    search,
    limit,
    offset,
    sorts
  });
}

export default function SupplierTypesRoute() {
  const { data, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SupplierTypesTable data={data ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
