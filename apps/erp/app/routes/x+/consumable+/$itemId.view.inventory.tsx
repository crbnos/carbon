import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useShelves } from "~/components/Form/Shelf";
import { useRouteData } from "~/hooks";
import { InventoryDetails } from "~/modules/inventory";

import type { Consumable, UnitOfMeasureListItem } from "~/modules/items";
import {
  getItemQuantities,
  getItemShelfQuantities,
  getPickMethod,
  pickMethodValidator,
  upsertPickMethod,
} from "~/modules/items";
import { PickMethodForm } from "~/modules/items/ui/Item";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { useItems } from "~/stores/items";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.consumable(itemId),
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
        path.to.consumable(itemId),
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  let [consumableInventory] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId),
  ]);

  if (consumableInventory.error || !consumableInventory.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId,
    });

    if (insertPickMethod.error) {
      throw redirect(
        path.to.consumable(itemId),
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert consumable inventory")
        )
      );
    }

    consumableInventory = await getPickMethod(
      client,
      itemId,
      companyId,
      locationId
    );
    if (consumableInventory.error || !consumableInventory.data) {
      throw redirect(
        path.to.consumable(itemId),
        await flash(
          request,
          error(
            consumableInventory.error,
            "Failed to load consumable inventory"
          )
        )
      );
    }
  }

  const quantities = await getItemQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (quantities.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(quantities, "Failed to load consumable quantities")
      )
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
      path.to.items,
      await flash(
        request,
        error(itemShelfQuantities, "Failed to load consumable quantities")
      )
    );
  }

  return json({
    consumableInventory: consumableInventory.data,
    itemShelfQuantities: itemShelfQuantities.data,
    quantities: quantities.data,
    itemId,
    locationId,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  // validate with consumablesValidator
  const validation = await validator(pickMethodValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { ...update } = validation.data;

  const updatePickMethod = await upsertPickMethod(client, {
    ...update,
    itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updatePickMethod.error) {
    throw redirect(
      path.to.consumable(itemId),
      await flash(
        request,
        error(updatePickMethod.error, "Failed to update consumable inventory")
      )
    );
  }

  throw redirect(
    path.to.consumableInventoryLocation(itemId, update.locationId),
    await flash(request, success("Updated consumable inventory"))
  );
}

export default function ConsumableInventoryRoute() {
  const sharedConsumablesData = useRouteData<{
    locations: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.consumableRoot);

  const { consumableInventory, itemShelfQuantities, quantities, itemId } =
    useLoaderData<typeof loader>();

  const consumableData = useRouteData<{
    consumableSummary: Consumable;
  }>(path.to.consumable(itemId));
  if (!consumableData) throw new Error("Could not find consumable data");
  const itemUnitOfMeasureCode =
    consumableData?.consumableSummary?.unitOfMeasureCode;

  const initialValues = {
    ...consumableInventory,
    defaultShelfId: consumableInventory.defaultShelfId ?? undefined,
    ...getCustomFields(consumableInventory.customFields ?? {}),
  };

  const shelves = useShelves(consumableInventory?.locationId);

  const [items] = useItems();
  const itemTrackingType = items.find((i) => i.id === itemId)?.itemTrackingType;

  return (
    <VStack spacing={2} className="p-2">
      <PickMethodForm
        key={initialValues.itemId}
        initialValues={initialValues}
        locations={sharedConsumablesData?.locations ?? []}
        shelves={shelves.options}
        type="Part"
      />
      <InventoryDetails
        itemShelfQuantities={itemShelfQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode ?? "EA"}
        itemTrackingType={itemTrackingType ?? "Inventory"}
        pickMethod={initialValues}
        quantities={quantities}
        shelves={shelves.options}
      />
    </VStack>
  );
}
