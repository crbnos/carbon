import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import {
  PartInventoryForm,
  getItemInventory,
  getItemQuantities,
  getShelvesList,
  itemInventoryValidator,
  upsertItemInventory,
} from "~/modules/parts";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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

  let [partInventory, shelves] = await Promise.all([
    getItemInventory(client, itemId, companyId, locationId),
    getShelvesList(client, locationId),
  ]);

  if (partInventory.error || !partInventory.data) {
    const insertItemInventory = await upsertItemInventory(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId,
    });

    if (insertItemInventory.error) {
      throw redirect(
        path.to.part(itemId),
        await flash(
          request,
          error(insertItemInventory.error, "Failed to insert part inventory")
        )
      );
    }

    partInventory = await getItemInventory(
      client,
      itemId,
      companyId,
      locationId
    );
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

  if (shelves.error) {
    throw redirect(
      path.to.items,
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
      path.to.items,
      await flash(request, error(quantities, "Failed to load part quantities"))
    );
  }

  return json({
    partInventory: partInventory.data,
    quantities: quantities.data,
    shelves: shelves.data.map((s) => s.id),
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
  // validate with partsValidator
  const validation = await validator(itemInventoryValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { ...update } = validation.data;

  const updateItemInventory = await upsertItemInventory(client, {
    ...update,
    itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateItemInventory.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(updateItemInventory.error, "Failed to update part inventory")
      )
    );
  }

  throw redirect(
    path.to.partInventoryLocation(itemId, update.locationId),
    await flash(request, success("Updated part inventory"))
  );
}

export default function PartInventoryRoute() {
  const sharedPartssData = useRouteData<{ locations: ListItem[] }>(
    path.to.partRoot
  );
  const { partInventory, quantities, shelves } = useLoaderData<typeof loader>();

  const initialValues = {
    ...partInventory,
    defaultShelfId: partInventory.defaultShelfId ?? undefined,
    ...getCustomFields(partInventory.customFields ?? {}),
  };
  return (
    <PartInventoryForm
      key={initialValues.itemId}
      initialValues={initialValues}
      quantities={quantities}
      locations={sharedPartssData?.locations ?? []}
      shelves={shelves}
    />
  );
}
