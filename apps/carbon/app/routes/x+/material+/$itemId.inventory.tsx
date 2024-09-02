import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import {
  PickMethodForm,
  getItemQuantities,
  getPickMethod,
  getShelvesList,
  pickMethodValidator,
  upsertPickMethod,
} from "~/modules/items";
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

  let [materialInventory, shelves] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId),
    getShelvesList(client, locationId),
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
      await flash(
        request,
        error(quantities, "Failed to load material quantities")
      )
    );
  }

  return json({
    materialInventory: materialInventory.data,
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
  const sharedMaterialsData = useRouteData<{ locations: ListItem[] }>(
    path.to.materialRoot
  );
  const { materialInventory, quantities, shelves } =
    useLoaderData<typeof loader>();

  const initialValues = {
    ...materialInventory,
    defaultShelfId: materialInventory.defaultShelfId ?? undefined,
    ...getCustomFields(materialInventory.customFields ?? {}),
  };
  return (
    <PickMethodForm
      key={initialValues.itemId}
      initialValues={initialValues}
      quantities={quantities}
      locations={sharedMaterialsData?.locations ?? []}
      shelves={shelves}
      type="Material"
    />
  );
}
