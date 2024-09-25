import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ConsumablesTable,
  getConsumables,
  getItemPostingGroupsList,
} from "~/modules/items";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Consumables",
  to: path.to.consumables,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [consumables, itemPostingGroups] = await Promise.all([
    getConsumables(client, companyId, {
      search,
      supplierId,
      limit,
      offset,
      sorts,
      filters,
    }),
    getItemPostingGroupsList(client, companyId),
  ]);

  if (consumables.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(consumables.error, "Failed to fetch consumables")
      )
    );
  }

  return json({
    count: consumables.count ?? 0,
    consumables: consumables.data ?? [],
    itemPostingGroups: itemPostingGroups.data ?? [],
  });
}

export default function ConsumablesSearchRoute() {
  const { count, consumables, itemPostingGroups } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ConsumablesTable
        data={consumables}
        count={count}
        itemPostingGroups={itemPostingGroups}
      />
      <Outlet />
    </VStack>
  );
}
