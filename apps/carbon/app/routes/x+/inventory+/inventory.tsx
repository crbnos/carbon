import { ResizablePanel, ResizablePanelGroup, VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { InventoryItem } from "~/modules/inventory";
import { getInventoryItems } from "~/modules/inventory";
import InventoryTable from "~/modules/inventory/ui/Inventory/InventoryTable";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
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

  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const inventoryItems = await getInventoryItems(
    client,
    companyId,
    locationId,
    {
      search,
      favorite,
      recent,
      createdBy,
      active,
      limit,
      offset,
      sorts,
      filters,
    }
  );

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
    locationId,
  });
}

export default function InventoryAllRoute() {
  const sharedPartsData = useRouteData<{ locations: ListItem[] }>(
    path.to.inventoryRoot
  );
  const { count, inventoryItems, locationId } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          defaultSize={50}
          maxSize={70}
          minSize={25}
          className="bg-background"
        >
          <InventoryTable
            data={inventoryItems}
            count={count}
            locationId={locationId}
            locations={sharedPartsData?.locations ?? []}
          />
        </ResizablePanel>
        <Outlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
