import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getAccountsList } from "~/modules/accounting";
import { getShippingMethods, ShippingMethodsTable } from "~/modules/inventory";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Shipping Methods`,
  to: path.to.shippingMethods
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyGroupId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [shippingMethods] = await Promise.all([
    getShippingMethods({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getAccountsList(companyGroupId)
  ]);

  if (shippingMethods.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(null, "Error loading shipping methods"))
    );
  }

  return {
    shippingMethods: shippingMethods.data ?? [],
    count: shippingMethods.count ?? 0
  };
}

export default function ShippingMethodsRoute() {
  const { shippingMethods, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ShippingMethodsTable data={shippingMethods ?? []} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
