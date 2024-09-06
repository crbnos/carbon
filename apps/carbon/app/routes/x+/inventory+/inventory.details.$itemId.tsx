import { ResizableHandle, ResizablePanel } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import InventoryDetailsView from "~/modules/inventory/ui/Inventory/InventoryDetailsView";
import {
  getItemQuantities,
  getPickMethod,
  getShelvesList,
  upsertPickMethod,
} from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
import { getCustomFields } from "~/utils/form";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory",
  });

  const { itemId } = params;
  if (!itemId) throw notFound("itemId not found");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
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

  let [partInventory, shelves] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId),
    getShelvesList(client, locationId),
  ]);

  if (partInventory.error || !partInventory.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId,
    });

    if (insertPickMethod.error) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert part inventory")
        )
      );
    }

    partInventory = await getPickMethod(client, itemId, companyId, locationId);
    if (partInventory.error || !partInventory.data) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(partInventory.error, "Failed to load part inventory")
        )
      );
    }
  }

  if (shelves.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(shelves.error, "Failed to load shelves"))
    );
  }

  const quantities = await getItemQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (quantities.error || !quantities.data) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(quantities, "Failed to load part quantities"))
    );
  }

  return json({
    partInventory: partInventory.data,
    quantities: quantities.data,
    shelves: shelves.data.map((s) => s.id),
  });
}

export default function ItemInventoryDetailsRoute() {
  const sharedPartsData = useRouteData<{ locations: ListItem[] }>(
    path.to.inventoryRoot
  );
  const { partInventory, quantities, shelves } = useLoaderData<typeof loader>();

  const initialValues = {
    ...partInventory,
    defaultShelfId: partInventory.defaultShelfId ?? undefined,
    ...getCustomFields(partInventory.customFields ?? {}),
  };
  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={50}
        maxSize={70}
        minSize={25}
        className="bg-background p-2"
      >
        <InventoryDetailsView
          key={initialValues.itemId}
          initialValues={initialValues}
          quantities={quantities}
          locations={sharedPartsData?.locations ?? []}
          shelves={shelves}
          type="Part"
        />
      </ResizablePanel>
    </>
  );
}
