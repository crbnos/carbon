import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { getAccountsList } from "~/modules/accounting";
import { ItemGroupsTable, getItemGroups } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Posting Groups",
  to: path.to.itemGroups,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [itemGroups, accounts] = await Promise.all([
    getItemGroups(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
    getAccountsList(client, companyId),
  ]);

  if (itemGroups.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading item groups"))
    );
  }

  if (accounts.error) {
    throw redirect(
      path.to.itemGroups,
      await flash(request, error(accounts.error, "Error loading accounts"))
    );
  }

  return json({
    itemGroups: itemGroups.data ?? [],
    count: itemGroups.count ?? 0,
    accounts: accounts.data ?? [],
  });
}

export default function ItemGroupsRoute() {
  const { itemGroups, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ItemGroupsTable data={itemGroups} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
