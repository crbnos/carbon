import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getAccountsList } from "~/modules/accounting";
import { ItemPostingGroupsTable, getItemPostingGroups } from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Posting Groups",
  to: path.to.itemPostingGroups,
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

  const [itemPostingGroups, accounts] = await Promise.all([
    getItemPostingGroups(client, companyId, {
      limit,
      offset,
      sorts,
      search,
      filters,
    }),
    getAccountsList(client, companyId),
  ]);

  if (itemPostingGroups.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(null, "Error loading item groups"))
    );
  }

  if (accounts.error) {
    throw redirect(
      path.to.itemPostingGroups,
      await flash(request, error(accounts.error, "Error loading accounts"))
    );
  }

  return json({
    itemPostingGroups: itemPostingGroups.data ?? [],
    count: itemPostingGroups.count ?? 0,
    accounts: accounts.data ?? [],
  });
}

export default function ItemPostingGroupsRoute() {
  const { itemPostingGroups, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ItemPostingGroupsTable data={itemPostingGroups} count={count ?? 0} />
      <Outlet />
    </VStack>
  );
}
