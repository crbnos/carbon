import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useShelves } from "~/components/Form/Shelf";
import { InventoryDetails } from "~/modules/inventory";
import {
  getItem,
  getItemQuantities,
  getItemShelfQuantities,
  getMakeMethodById,
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId,
  getPickMethod,
  upsertPickMethod
} from "~/modules/items";
import { BillOfMaterial, BillOfProcess } from "~/modules/items/ui/Item";
import { getLocationsList } from "~/modules/resources";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { getTagsList } from "~/modules/shared";
import { getUserDefaults } from "~/modules/users/users.server";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory"
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
    getPickMethod(client, itemId, companyId, locationId)
  ]);

  if (pickMethod.error || !pickMethod.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId
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
    getItem(client, itemId)
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

  // Load manufacturing data for manufactured parts
  let methodData = null;
  let tags: { name: string }[] = [];

  if (item.data.replenishmentSystem !== "Buy") {
    const makeMethods = await getMakeMethods(client, itemId, companyId);
    const makeMethod =
      makeMethods.data?.find((m) => m.status === "Active") ??
      makeMethods.data?.[0];

    if (makeMethod) {
      const fullMethod = await getMakeMethodById(
        client,
        makeMethod.id,
        companyId
      );
      if (!fullMethod.error && fullMethod.data) {
        const [methodMaterials, methodOperations, operationTags] =
          await Promise.all([
            getMethodMaterialsByMakeMethod(client, fullMethod.data.id),
            getMethodOperationsByMakeMethodId(client, fullMethod.data.id),
            getTagsList(client, companyId, "operation")
          ]);

        methodData = {
          makeMethod: fullMethod.data,
          methodMaterials:
            methodMaterials.data?.map((m) => ({
              ...m,
              description: m.item?.name ?? "",
              methodType: m.methodType as MethodType,
              itemType: m.itemType as MethodItemType
            })) ?? [],
          methodOperations:
            methodOperations.data?.map((operation) => ({
              ...operation,
              workCenterId: operation.workCenterId ?? undefined,
              operationSupplierProcessId:
                operation.operationSupplierProcessId ?? undefined,
              workInstruction: operation.workInstruction as JSONContent | null
            })) ?? []
        };
        tags = operationTags.data ?? [];
      }
    }
  }

  return {
    pickMethod: pickMethod.data,
    quantities: quantities.data,
    itemShelfQuantities: itemShelfQuantities.data,
    item: item.data,
    methodData,
    tags
  };
}

export default function ItemInventoryRoute() {
  const {
    pickMethod,
    quantities,
    itemShelfQuantities,
    item,
    methodData,
    tags
  } = useLoaderData<typeof loader>();

  const [items] = useItems();
  const itemTrackingType = items.find(
    (i) => i.id === item.id
  )?.itemTrackingType;

  const shelves = useShelves(pickMethod?.locationId);

  return (
    <VStack spacing={2}>
      <InventoryDetails
        itemShelfQuantities={itemShelfQuantities}
        itemUnitOfMeasureCode={item.unitOfMeasureCode ?? "EA"}
        itemTrackingType={itemTrackingType ?? "Inventory"}
        pickMethod={{
          ...pickMethod,
          defaultShelfId: pickMethod.defaultShelfId ?? undefined
        }}
        quantities={quantities}
        shelves={shelves.options}
      />
      {methodData && (
        <>
          <BillOfMaterial
            makeMethod={methodData.makeMethod}
            // @ts-ignore
            materials={methodData.methodMaterials}
            // @ts-ignore
            operations={methodData.methodOperations}
          />
          <BillOfProcess
            makeMethod={methodData.makeMethod}
            // @ts-ignore
            operations={methodData.methodOperations}
            // @ts-ignore
            materials={methodData.methodMaterials}
            tags={tags}
          />
        </>
      )}
    </VStack>
  );
}
