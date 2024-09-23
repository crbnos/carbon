import {
  ClientOnly,
  ResizablePanel,
  ResizablePanelGroup,
  VStack,
} from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { InventoryItem } from "~/modules/inventory";
import { getInventoryItems } from "~/modules/inventory";
import InventoryTable from "~/modules/inventory/ui/Inventory/InventoryTable";
import {
  getMaterialFormsList,
  getMaterialSubstancesList,
  type UnitOfMeasureListItem,
} from "~/modules/items";
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

  const [inventoryItems, items, forms, substances] = await Promise.all([
    getInventoryItems(client, locationId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    client
      .from("item")
      .select("id", { count: "exact" })
      .eq("itemTrackingType", "Inventory"),
    getMaterialFormsList(client, companyId),
    getMaterialSubstancesList(client, companyId),
  ]);

  if (inventoryItems.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(inventoryItems.error, "Failed to fetch inventory items")
      )
    );
  }

  if (items.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(items.error, "Failed to fetch item count"))
    );
  }

  return json({
    count: items.count ?? 0,
    inventoryItems: (inventoryItems.data ?? []) as InventoryItem[],
    locationId,
    forms: forms.data ?? [],
    substances: substances.data ?? [],
  });
}

export default function QuantitiesRoute() {
  const sharedData = useRouteData<{
    locations: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.inventoryRoot);
  const { count, inventoryItems, locationId, forms, substances } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ClientOnly>
        {() => (
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
                locations={sharedData?.locations ?? []}
                unitOfMeasures={sharedData?.unitOfMeasures ?? []}
                forms={forms}
                substances={substances}
              />
            </ResizablePanel>
            <Outlet />
          </ResizablePanelGroup>
        )}
      </ClientOnly>
    </VStack>
  );
}
