import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getAccountsList } from "~/modules/accounting";
import { ShippingMethodsTable, getShippingMethods } from "~/modules/inventory";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Shipping Methods",
  to: path.to.shippingMethods,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [shippingMethods] = await Promise.all([
    getShippingMethods(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getAccountsList(client, companyId),
  ]);

  if (shippingMethods.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(null, "Error loading shipping methods"))
    );
  }

  return json({
    shippingMethods: shippingMethods.data ?? [],
    count: shippingMethods.count ?? 0,
  });
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
