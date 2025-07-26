import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useShelves } from "~/components/Form/Shelf";
import { InventoryDetails } from "~/modules/inventory";
import {
  getItem,
  getItemQuantities,
  getItemShelfQuantities,
  getPickMethod,
  upsertPickMethod,
} from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";

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

  let [pickMethod] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId),
  ]);

  if (pickMethod.error || !pickMethod.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId,
    });

    if (
      insertPickMethod.error &&
      !insertPickMethod.error.message.includes("duplicate key value")
    ) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert part inventory")
        )
      );
    }

    pickMethod = await getPickMethod(client, itemId, companyId, locationId);
    if (pickMethod.error || !pickMethod.data) {
      throw redirect(
        path.to.inventory,
        await flash(
          request,
          error(pickMethod.error, "Failed to load part inventory")
        )
      );
    }
  }

  const [quantities, item] = await Promise.all([
    getItemQuantities(client, itemId, companyId, locationId),
    getItem(client, itemId),
  ]);
  if (quantities.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(quantities, "Failed to load part quantities"))
    );
  }

  if (item.error || !item.data) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(item.error, "Failed to load item"))
    );
  }

  const itemShelfQuantities = await getItemShelfQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (itemShelfQuantities.error || !itemShelfQuantities.data) {
    throw redirect(
      path.to.inventory,
      await flash(
        request,
        error(itemShelfQuantities.error, "Failed to load item shelf quantities")
      )
    );
  }

  return json({
    pickMethod: pickMethod.data,
    quantities: quantities.data,
    itemShelfQuantities: itemShelfQuantities.data,
    item: item.data,
  });
}

export default function ItemInventoryRoute() {
  const { pickMethod, quantities, itemShelfQuantities, item } =
    useLoaderData<typeof loader>();

  const [items] = useItems();
  const itemTrackingType = items.find(
    (i) => i.id === item.id
  )?.itemTrackingType;

  const shelves = useShelves(pickMethod?.locationId);

  return (
    <InventoryDetails
      itemShelfQuantities={itemShelfQuantities}
      itemUnitOfMeasureCode={item.unitOfMeasureCode ?? "EA"}
      itemTrackingType={itemTrackingType ?? "Inventory"}
      pickMethod={{
        ...pickMethod,
        defaultShelfId: pickMethod.defaultShelfId ?? undefined,
      }}
      quantities={quantities}
      shelves={shelves.options}
    />
  );
}
