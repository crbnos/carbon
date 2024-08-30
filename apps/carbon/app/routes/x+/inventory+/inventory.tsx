import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { InventoryItem } from "~/modules/inventory";
import { getInventoryItems } from "~/modules/inventory";
import InventoryTable from "~/modules/inventory/ui/Inventory/InventoryTable";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filter = searchParams.get("q");

  const createdBy = filter === "my" ? userId : undefined;
  const favorite = filter === "starred" ? true : undefined;
  const recent = filter === "recent" ? true : undefined;
  const active = filter === "trash" ? false : true;

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const inventoryItems = await getInventoryItems(client, companyId, {
    search,
    favorite,
    recent,
    createdBy,
    active,
    limit,
    offset,
    sorts,
    filters,
  });

  if (inventoryItems.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(inventoryItems.error, "Failed to fetch inventory items")
      )
    );
  }

  return json({
    count: inventoryItems.count ?? 0,
    inventoryItems: (inventoryItems.data ?? []) as InventoryItem[],
  });
}

export default function InventoryAllRoute() {
  const { count, inventoryItems } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <InventoryTable data={inventoryItems} count={count} />
      <Outlet />
    </VStack>
  );
}
