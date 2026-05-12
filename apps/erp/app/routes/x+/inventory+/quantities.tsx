import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ResizablePanel, ResizablePanelGroup, VStack } from "@carbon/react";
import { pluckUnique } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import type { InventoryItem } from "~/modules/inventory";
import {
  expandStorageUnitIdsWithDescendants,
  getInventoryItems,
  getStorageTypesList
} from "~/modules/inventory";
import InventoryTable from "~/modules/inventory/ui/Inventory/InventoryTable";
import {
  getMaterialFormsList,
  getMaterialSubstancesList
} from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import { getUserDefaults } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const storageUnitFilter = filters?.find(
    (f) => f.column === "storageUnitIds" && f.value
  );
  if (storageUnitFilter?.value) {
    const ids = storageUnitFilter.value.split(",");
    const expanded = await expandStorageUnitIdsWithDescendants(client, ids);
    storageUnitFilter.value = expanded.join(",");
  }

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

  const [inventoryItems, forms, substances, tags, storageTypes] =
    await Promise.all([
      getInventoryItems(client, locationId, companyId, {
        search,
        limit,
        offset,
        sorts,
        filters
      }),
      getMaterialFormsList(client, companyId),
      getMaterialSubstancesList(client, companyId),
      getTagsList(client, companyId),
      getStorageTypesList(client, companyId)
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

  const uniqueTags = pluckUnique(tags.data, (t) => t.name);

  return {
    count: inventoryItems.count ?? 0,
    inventoryItems: (inventoryItems.data ?? []) as InventoryItem[],
    locationId,
    forms: forms.data ?? [],
    substances: substances.data ?? [],
    tags: uniqueTags,
    storageTypes: storageTypes.data ?? []
  };
}

export default function QuantitiesRoute() {
  const {
    count,
    inventoryItems,
    locationId,
    forms,
    substances,
    tags,
    storageTypes
  } = useLoaderData<typeof loader>();

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
            forms={forms}
            substances={substances}
            tags={tags}
            storageTypes={storageTypes}
          />
        </ResizablePanel>
        <Outlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
