import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import {
  ItemPlanningForm,
  getItemPlanning,
  itemPlanningValidator,
  upsertItemPlanning,
} from "~/modules/items";
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

  let materialPlanning = await getItemPlanning(
    client,
    itemId,
    companyId,
    locationId
  );

  if (materialPlanning.error || !materialPlanning.data) {
    const insertMateriallanning = await upsertItemPlanning(client, {
      itemId,
      companyId,
      locationId,
      createdBy: userId,
    });

    if (insertMateriallanning.error) {
      throw redirect(
        path.to.material(itemId),
        await flash(
          request,
          error(
            insertMateriallanning.error,
            "Failed to insert material planning"
          )
        )
      );
    }

    materialPlanning = await getItemPlanning(
      client,
      itemId,
      companyId,
      locationId
    );
    if (materialPlanning.error || !materialPlanning.data) {
      throw redirect(
        path.to.material(itemId),
        await flash(
          request,
          error(materialPlanning.error, "Failed to load material planning")
        )
      );
    }
  }

  return json({
    materialPlanning: materialPlanning.data,
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

  const updateMateriallanning = await upsertItemPlanning(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateMateriallanning.error) {
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(updateMateriallanning.error, "Failed to update material planning")
      )
    );
  }

  throw redirect(
    path.to.materialPlanningLocation(itemId, validation.data.locationId),
    await flash(request, success("Updated material planning"))
  );
}

export default function MateriallanningRoute() {
  const sharedMaterialsData = useRouteData<{
    locations: ListItem[];
  }>(path.to.materialRoot);

  const { materialPlanning } = useLoaderData<typeof loader>();

  if (!sharedMaterialsData)
    throw new Error("Could not load shared materials data");

  return (
    <ItemPlanningForm
      key={materialPlanning.itemId}
      initialValues={{
        ...materialPlanning,
        ...getCustomFields(materialPlanning.customFields),
      }}
      locations={sharedMaterialsData.locations ?? []}
      type="Material"
    />
  );
}
