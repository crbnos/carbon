// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  RecordOutlet,
  ResizablePanel,
  ResizablePanelGroup,
  VStack
} from "@carbon/react";
import { pluckUnique, redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { expandStorageUnitIdsWithDescendants } from "~/modules/inventory/inventory.service";
import type { InventoryItem } from "~/modules/inventory/types";
import InventoryTable from "~/modules/inventory/ui/Inventory/InventoryTable";
import { getUserDefaults } from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["itemStockQuantities"]
};

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
  });
  const { client, companyId, userId } = auth;
  const api = carbonFor(auth);

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
        path.to.authenticatedRoot,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await api.resources.getLocationsList({});
    if (locations.error || !locations.data?.length) {
      // `path.to.inventory` *is* this route — redirecting here loops forever.
      // On error bail to the app root; with zero locations (a company that
      // can't show inventory at all) send them to create one.
      throw redirect(
        locations.error ? path.to.authenticatedRoot : path.to.locations,
        await flash(
          request,
          error(
            locations.error,
            locations.error
              ? "Failed to load any locations"
              : "Create a location to manage inventory"
          )
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  const [inventoryItems, forms, substances, tags, storageTypes, storageUnits] =
    await Promise.all([
      api.inventory.getInventoryItems({
        search,
        limit,
        offset,
        sorts,
        filters,
        locationId
      }),
      api.items.getMaterialFormsList({}),
      api.items.getMaterialSubstancesList({}),
      api.shared.getTagsList({}),
      api.inventory.getStorageTypesList({}),
      api.inventory.getStorageUnitsList({})
    ]);

  if (inventoryItems.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error(inventoryItems.error, "Failed to fetch inventory items")
      )
    );
  }

  const uniqueTags = pluckUnique(tags.data, (t) => t.name);

  return {
    count: inventoryItems.data?.count ?? 0,
    inventoryItems: (inventoryItems.data?.rows ?? []) as InventoryItem[],
    locationId,
    forms: forms.data ?? [],
    substances: substances.data ?? [],
    tags: uniqueTags,
    storageTypes: storageTypes.data ?? [],
    storageUnits: storageUnits.data ?? []
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
    storageTypes,
    storageUnits
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full ">
      <ResizablePanelGroup direction="horizontal" stackOnCompact>
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
            storageUnits={storageUnits}
          />
        </ResizablePanel>
        <RecordOutlet />
      </ResizablePanelGroup>
    </VStack>
  );
}
