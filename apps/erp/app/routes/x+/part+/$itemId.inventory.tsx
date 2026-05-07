import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { pluckUnique } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useStorageUnits } from "~/components/Form/StorageUnit";
import { useRouteData } from "~/hooks";
import {
  getTrackedEntityExpirations,
  InventoryDetails
} from "~/modules/inventory";
import type { PartSummary, UnitOfMeasureListItem } from "~/modules/items";
import {
  getBomHasShelfLifeManagedInput,
  getItemQuantities,
  getItemShelfLife,
  getItemStorageUnitQuantities,
  getPickMethod,
  pickMethodWithShelfLifeValidator,
  type shelfLifeModes,
  upsertPickMethod,
  upsertPickMethodWithShelfLife
} from "~/modules/items";
import { getItemRulesDataForItem } from "~/modules/items/itemRules.server";
import { PickMethodForm } from "~/modules/items/ui/Item";
import ItemRuleAssignments from "~/modules/items/ui/ItemRules/ItemRuleAssignments";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { useItems } from "~/stores";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
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
        path.to.part(itemId),
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
        path.to.part(itemId),
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  let [partInventory] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId)
  ]);

  if (partInventory.error || !partInventory.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId
    });

    if (insertPickMethod.error) {
      throw redirect(
        path.to.part(itemId),
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert part inventory")
        )
      );
    }

    partInventory = await getPickMethod(client, itemId, companyId, locationId);
    if (partInventory.error || !partInventory.data) {
      throw redirect(
        path.to.part(itemId),
        await flash(
          request,
          error(partInventory.error, "Failed to load part inventory")
        )
      );
    }
  }

  const [
    quantities,
    itemStorageUnitQuantities,
    shelfLife,
    bomHasShelfLifeManagedInput,
    rulesData
  ] = await Promise.all([
    getItemQuantities(client, itemId, companyId, locationId),
    getItemStorageUnitQuantities(client, itemId, companyId, locationId),
    getItemShelfLife(client, itemId),
    getBomHasShelfLifeManagedInput(client, itemId, companyId),
    getItemRulesDataForItem(client, itemId, companyId)
  ]);
  if (quantities.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(quantities, "Failed to load part quantities"))
    );
  }

  if (itemStorageUnitQuantities.error || !itemStorageUnitQuantities.data) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(itemStorageUnitQuantities, "Failed to load part quantities")
      )
    );
  }

  const trackedEntityIds = pluckUnique(
    itemStorageUnitQuantities.data,
    (row) => row.trackedEntityId
  );
  const trackedEntityExpirations = await getTrackedEntityExpirations(
    client,
    trackedEntityIds
  );

  return {
    partInventory: partInventory.data,
    itemStorageUnitQuantities: itemStorageUnitQuantities.data,
    quantities: quantities.data,
    shelfLife: shelfLife.data,
    bomHasShelfLifeManagedInput,
    trackedEntityExpirations,
    itemId,
    locationId,
    ruleAssignments: rulesData.assignments,
    ruleLibrary: rulesData.library
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(pickMethodWithShelfLifeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    shelfLifeMode,
    shelfLifeDays,
    shelfLifeTriggerProcessId,
    shelfLifeTriggerTiming,
    shelfLifeCalculateFromBom,
    ...pickMethodFields
  } = validation.data;

  try {
    await upsertPickMethodWithShelfLife(getDatabaseClient(), {
      itemId,
      locationId: pickMethodFields.locationId,
      defaultStorageUnitId: pickMethodFields.defaultStorageUnitId,
      customFields: setCustomFields(formData),
      userId,
      shelfLife: {
        mode: shelfLifeMode,
        days: shelfLifeDays,
        triggerProcessId: shelfLifeTriggerProcessId,
        triggerTiming: shelfLifeTriggerTiming,
        calculateFromBom: shelfLifeCalculateFromBom
      }
    });
  } catch (err) {
    throw redirect(
      path.to.part(itemId),
      await flash(request, error(err, "Failed to update part inventory"))
    );
  }

  throw redirect(
    path.to.partInventoryLocation(itemId, pickMethodFields.locationId),
    await flash(request, success("Updated part inventory"))
  );
}

export default function PartInventoryRoute() {
  const sharedPartsData = useRouteData<{
    locations: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.partRoot);

  const {
    partInventory,
    itemStorageUnitQuantities,
    quantities,
    shelfLife,
    bomHasShelfLifeManagedInput,
    trackedEntityExpirations,
    itemId,
    ruleAssignments,
    ruleLibrary
  } = useLoaderData<typeof loader>();

  const partData = useRouteData<{
    partSummary: PartSummary;
  }>(path.to.part(itemId));
  if (!partData) throw new Error("Could not find part data");
  const itemUnitOfMeasureCode = partData?.partSummary?.unitOfMeasureCode;

  const initialValues = {
    ...partInventory,
    defaultStorageUnitId: partInventory.defaultStorageUnitId ?? undefined,
    shelfLifeMode: shelfLife?.mode as
      | (typeof shelfLifeModes)[number]
      | undefined,
    shelfLifeDays: shelfLife?.days ?? undefined,
    shelfLifeTriggerProcessId: shelfLife?.triggerProcessId ?? undefined,
    shelfLifeTriggerTiming: shelfLife?.triggerTiming ?? undefined,
    shelfLifeCalculateFromBom: shelfLife?.calculateFromBom ?? false,
    ...getCustomFields(partInventory.customFields ?? {})
  };

  const [items] = useItems();
  const item = items.find((i) => i.id === itemId);
  const itemTrackingType = item?.itemTrackingType;
  const replenishmentSystem = item?.replenishmentSystem ?? null;

  const storageUnits = useStorageUnits(partInventory?.locationId);

  return (
    <VStack spacing={2} className="p-2">
      <PickMethodForm
        key={`${initialValues.itemId}-${itemTrackingType ?? "Inventory"}`}
        initialValues={initialValues}
        locations={sharedPartsData?.locations ?? []}
        storageUnits={storageUnits.options}
        type="Part"
        itemTrackingType={itemTrackingType ?? "Inventory"}
        replenishmentSystem={replenishmentSystem}
        bomHasShelfLifeManagedInput={bomHasShelfLifeManagedInput}
      />
      <InventoryDetails
        itemStorageUnitQuantities={itemStorageUnitQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode ?? "EA"}
        itemTrackingType={itemTrackingType ?? "Inventory"}
        itemShelfLife={shelfLife ?? null}
        trackedEntityExpirations={trackedEntityExpirations}
        pickMethod={initialValues}
        quantities={quantities}
        storageUnits={storageUnits.options}
      />
      <ItemRuleAssignments
        itemId={itemId}
        assignments={ruleAssignments as never}
        library={ruleLibrary as never}
      />
    </VStack>
  );
}
