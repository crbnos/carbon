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

  let partPlanning = await getItemPlanning(
    client,
    itemId,
    companyId,
    locationId
  );

  if (partPlanning.error || !partPlanning.data) {
    const insertPartPlanning = await upsertItemPlanning(client, {
      itemId,
      companyId,
      locationId,
      createdBy: userId,
    });

    if (insertPartPlanning.error) {
      throw redirect(
        path.to.part(itemId),
        await flash(
          request,
          error(insertPartPlanning.error, "Failed to insert part planning")
        )
      );
    }

    partPlanning = await getItemPlanning(client, itemId, companyId, locationId);
    if (partPlanning.error || !partPlanning.data) {
      throw redirect(
        path.to.part(itemId),
        await flash(
          request,
          error(partPlanning.error, "Failed to load part planning")
        )
      );
    }
  }

  return json({
    partPlanning: partPlanning.data,
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

  const updatePartPlanning = await upsertItemPlanning(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePartPlanning.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(updatePartPlanning.error, "Failed to update part planning")
      )
    );
  }

  throw redirect(
    path.to.partPlanningLocation(itemId, validation.data.locationId),
    await flash(request, success("Updated part planning"))
  );
}

export default function PartPlanningRoute() {
  const sharedPartsData = useRouteData<{
    locations: ListItem[];
  }>(path.to.partRoot);

  const { partPlanning, locationId } = useLoaderData<typeof loader>();

  if (!sharedPartsData) throw new Error("Could not load shared parts data");

  return (
    <VStack spacing={2} className="p-2">
      <ItemPlanningForm
        key={partPlanning.itemId}
        initialValues={{
          ...partPlanning,
          ...getCustomFields(partPlanning.customFields),
        }}
        locations={sharedPartsData.locations ?? []}
        type="Part"
      />
      <ItemPlanningChart itemId={partPlanning.itemId} locationId={locationId} />
    </VStack>
  );
}
