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
import type { ToolSummary, UnitOfMeasureListItem } from "~/modules/items";
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
import { useItems } from "~/stores/items";
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
        path.to.tool(itemId),
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
        path.to.tool(itemId),
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  let [toolInventory] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId)
  ]);

  if (toolInventory.error || !toolInventory.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId
    });

    if (insertPickMethod.error) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert tool inventory")
        )
      );
    }

    toolInventory = await getPickMethod(client, itemId, companyId, locationId);
    if (toolInventory.error || !toolInventory.data) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(toolInventory.error, "Failed to load tool inventory")
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
      await flash(request, error(quantities, "Failed to load tool quantities"))
    );
  }

  const itemStorageUnitQuantities = await getItemStorageUnitQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (itemStorageUnitQuantities.error || !itemStorageUnitQuantities.data) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(itemStorageUnitQuantities, "Failed to load tool quantities")
      )
    );
  }

  const trackedEntityIds = pluckUnique(
    itemStorageUnitQuantities.data,
    (row) => row.trackedEntityId
  );

  const [
    shelfLife,
    bomHasShelfLifeManagedInput,
    trackedEntityExpirations,
    rulesData
  ] = await Promise.all([
    getItemShelfLife(client, itemId),
    getBomHasShelfLifeManagedInput(client, itemId, companyId),
    getTrackedEntityExpirations(client, trackedEntityIds),
    getItemRulesDataForItem(client, itemId, companyId)
  ]);

  return {
    toolInventory: toolInventory.data,
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
      path.to.tool(itemId),
      await flash(request, error(err, "Failed to update tool inventory"))
    );
  }

  throw redirect(
    path.to.toolInventoryLocation(itemId, pickMethodFields.locationId),
    await flash(request, success("Updated tool inventory"))
  );
}

export default function ToolInventoryRoute() {
  const sharedToolsData = useRouteData<{
    locations: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.toolRoot);

  const {
    toolInventory,
    itemStorageUnitQuantities,
    quantities,
    shelfLife,
    bomHasShelfLifeManagedInput,
    trackedEntityExpirations,
    itemId,
    ruleAssignments,
    ruleLibrary
  } = useLoaderData<typeof loader>();

  const toolData = useRouteData<{
    toolSummary: ToolSummary;
  }>(path.to.tool(itemId));
  if (!toolData) throw new Error("Could not find tool data");
  const itemUnitOfMeasureCode = toolData?.toolSummary?.unitOfMeasureCode;

  const initialValues = {
    ...toolInventory,
    defaultStorageUnitId: toolInventory.defaultStorageUnitId ?? undefined,
    shelfLifeMode: shelfLife?.mode as
      | (typeof shelfLifeModes)[number]
      | undefined,
    shelfLifeDays: shelfLife?.days ?? undefined,
    shelfLifeTriggerProcessId: shelfLife?.triggerProcessId ?? undefined,
    shelfLifeTriggerTiming: shelfLife?.triggerTiming ?? undefined,
    shelfLifeCalculateFromBom: shelfLife?.calculateFromBom ?? false,
    ...getCustomFields(toolInventory.customFields ?? {})
  };

  const [items] = useItems();
  const item = items.find((i) => i.id === itemId);
  const itemTrackingType = item?.itemTrackingType;
  const replenishmentSystem = item?.replenishmentSystem ?? null;

  const storageUnits = useStorageUnits(toolInventory?.locationId);

  return (
    <VStack spacing={2} className="p-2">
      <PickMethodForm
        key={`${initialValues.itemId}-${itemTrackingType ?? "Inventory"}`}
        initialValues={initialValues}
        locations={sharedToolsData?.locations ?? []}
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
