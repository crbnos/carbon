import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getChangeOrders, getChangeOrderTypesList } from "~/modules/items";
import { ChangeOrdersTable } from "~/modules/items/ui/ChangeOrder";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [changeOrders, types] = await Promise.all([
    getChangeOrders(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getChangeOrderTypesList(client, companyId)
  ]);

  if (changeOrders.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(changeOrders.error, "Error loading change orders")
      )
    );
  }

  return {
    changeOrders: changeOrders.data ?? [],
    count: changeOrders.count ?? 0,
    types: types.data ?? []
  };
}

export default function ChangeOrdersIndexRoute() {
  const { changeOrders, count, types } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ChangeOrdersTable data={changeOrders} count={count} types={types} />
      <Outlet />
    </VStack>
  );
}
