import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import {
  getItemPlanning,
  itemPlanningValidator,
  upsertItemPlanning,
} from "~/modules/items";
import { ItemPlanningForm } from "~/modules/items/ui/Item";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
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

  let consumablePlanning = await getItemPlanning(
    client,
    itemId,
    companyId,
    locationId
  );

  if (consumablePlanning.error || !consumablePlanning.data) {
    const insertConsumablePlanning = await upsertItemPlanning(client, {
      itemId,
      companyId,
      locationId,
      createdBy: userId,
    });

    if (insertConsumablePlanning.error) {
      throw redirect(
        path.to.consumable(itemId),
        await flash(
          request,
          error(
            insertConsumablePlanning.error,
            "Failed to insert consumable planning"
          )
        )
      );
    }

    consumablePlanning = await getItemPlanning(
      client,
      itemId,
      companyId,
      locationId
    );
    if (consumablePlanning.error || !consumablePlanning.data) {
      throw redirect(
        path.to.consumable(itemId),
        await flash(
          request,
          error(consumablePlanning.error, "Failed to load consumable planning")
        )
      );
    }
  }

  return json({
    consumablePlanning: consumablePlanning.data,
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
  const validation = await validator(itemPlanningValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateConsumablePlanning = await upsertItemPlanning(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateConsumablePlanning.error) {
    throw redirect(
      path.to.consumable(itemId),
      await flash(
        request,
        error(
          updateConsumablePlanning.error,
          "Failed to update consumable planning"
        )
      )
    );
  }

  throw redirect(
    path.to.consumablePlanningLocation(itemId, validation.data.locationId),
    await flash(request, success("Updated consumable planning"))
  );
}

export default function ConsumablePlanningRoute() {
  const sharedConsumablesData = useRouteData<{
    locations: ListItem[];
  }>(path.to.consumableRoot);

  const { consumablePlanning, locationId } = useLoaderData<typeof loader>();

  if (!sharedConsumablesData)
    throw new Error("Could not load shared consumables data");

  return (
    <VStack spacing={2} className="p-2">
      <ItemPlanningForm
        key={consumablePlanning.itemId}
        initialValues={{
          ...consumablePlanning,
          ...getCustomFields(consumablePlanning.customFields),
        }}
        locations={sharedConsumablesData.locations ?? []}
        type="Consumable"
      />
      <ItemPlanningChart
        itemId={consumablePlanning.itemId}
        locationId={locationId}
      />
    </VStack>
  );
}
