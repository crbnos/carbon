import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import { InventoryDetails } from "~/modules/inventory";
import type { UnitOfMeasureListItem } from "~/modules/items";
import {
  getItem,
  getItemQuantities,
  getItemShelfQuantities,
  getPickMethod,
  upsertPickMethod,
} from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
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

    if (insertPickMethod.error) {
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

  const routeData = useRouteData<{
    locations: ListItem[];
    shelves: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.inventoryRoot);

  return (
    <InventoryDetails
      itemShelfQuantities={itemShelfQuantities}
      itemUnitOfMeasureCode={item.unitOfMeasureCode ?? "EA"}
      locations={routeData?.locations ?? []}
      pickMethod={{
        ...pickMethod,
        defaultShelfId: pickMethod.defaultShelfId ?? undefined,
      }}
      quantities={quantities}
      shelves={routeData?.shelves ?? []}
      unitOfMeasures={routeData?.unitOfMeasures ?? []}
    />
  );
}
