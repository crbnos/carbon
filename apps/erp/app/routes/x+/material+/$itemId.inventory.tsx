import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { Await, useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { useRouteData } from "~/hooks";
import { getBatchProperties, InventoryDetails } from "~/modules/inventory";
import BatchPropertiesConfig from "~/modules/inventory/ui/Batches/BatchPropertiesConfig";
import type { Material, UnitOfMeasureListItem } from "~/modules/items";
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
        path.to.material(itemId),
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
        path.to.material(itemId),
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  let [materialInventory] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId),
  ]);

  if (materialInventory.error || !materialInventory.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId,
    });

    if (insertPickMethod.error) {
      throw redirect(
        path.to.material(itemId),
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert material inventory")
        )
      );
    }

    materialInventory = await getPickMethod(
      client,
      itemId,
      companyId,
      locationId
    );
    if (materialInventory.error || !materialInventory.data) {
      throw redirect(
        path.to.material(itemId),
        await flash(
          request,
          error(materialInventory.error, "Failed to load material inventory")
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
        error(quantities, "Failed to load material quantities")
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
        error(itemShelfQuantities, "Failed to load material quantities")
      )
    );
  }

  return defer({
    materialInventory: materialInventory.data,
    itemShelfQuantities: itemShelfQuantities.data,
    quantities: quantities.data,
    itemId,
    batchProperties: getBatchProperties(client, [itemId], companyId),
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
  // validate with materialsValidator
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
      path.to.material(itemId),
      await flash(
        request,
        error(updatePickMethod.error, "Failed to update material inventory")
      )
    );
  }

  throw redirect(
    path.to.materialInventoryLocation(itemId, update.locationId),
    await flash(request, success("Updated material inventory"))
  );
}

export default function MaterialInventoryRoute() {
  const sharedMaterialsData = useRouteData<{
    locations: ListItem[];
    shelves: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.materialRoot);

  const {
    materialInventory,
    itemShelfQuantities,
    quantities,
    itemId,
    batchProperties,
  } = useLoaderData<typeof loader>();

  const materialData = useRouteData<{
    materialSummary: Material;
  }>(path.to.material(itemId));
  if (!materialData) throw new Error("Could not find material data");
  const itemUnitOfMeasureCode =
    materialData?.materialSummary?.unitOfMeasureCode;

  const initialValues = {
    ...materialInventory,
    defaultShelfId: materialInventory.defaultShelfId ?? undefined,
    ...getCustomFields(materialInventory.customFields ?? {}),
  };
  return (
    <VStack spacing={2} className="p-2">
      <PickMethodForm
        key={initialValues.itemId}
        initialValues={initialValues}
        locations={sharedMaterialsData?.locations ?? []}
        shelves={sharedMaterialsData?.shelves ?? []}
        type="Material"
      />
      <InventoryDetails
        itemShelfQuantities={itemShelfQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode ?? "EA"}
        locations={sharedMaterialsData?.locations ?? []}
        pickMethod={initialValues}
        quantities={quantities}
        shelves={sharedMaterialsData?.shelves ?? []}
        unitOfMeasures={sharedMaterialsData?.unitOfMeasures ?? []}
      />
      {materialData.materialSummary?.itemTrackingType === "Batch" && (
        <Suspense fallback={null}>
          <Await resolve={batchProperties}>
            {(resolvedProperties) => (
              <BatchPropertiesConfig
                itemId={itemId}
                key={`batch-properties:${itemId}`}
                properties={resolvedProperties.data ?? []}
              />
            )}
          </Await>
        </Suspense>
      )}
    </VStack>
  );
}
