// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getItemPlanning,
  itemPlanningValidator,
  upsertItemPlanning
} from "~/modules/items";
import { ItemPlanningForm } from "~/modules/items/ui/Item";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import { replanAfterItemChange } from "~/modules/production/production.server";
import { getLocationsList } from "~/modules/resources";
import { isActiveCompanyEmployee } from "~/modules/shared/shared.server";
import { getUserDefaults } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
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
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(materialPlanning.error, "Failed to load material planning")
      )
    );
  }

  return {
    materialPlanning: materialPlanning.data,
    locationId
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(itemPlanningValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // The column references the global user table, so the database would take
  // a person from another company, or one since deactivated.
  if (
    validation.data.responsibleEmployee &&
    !(await isActiveCompanyEmployee(
      client,
      companyId,
      validation.data.responsibleEmployee
    ))
  ) {
    return validationError({
      fieldErrors: {
        responsibleEmployee: "Choose an employee of this company"
      },
      formId: validation.formId
    });
  }

  const updateMateriallanning = await upsertItemPlanning(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
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

  // The planning pages list MRP's suggestions; re-plan so they follow the
  // new settings now, not at the next scheduled run.
  await replanAfterItemChange(getDatabaseClient(), {
    itemId,
    companyId,
    userId
  });

  throw redirect(
    path.to.materialPlanningLocation(itemId, validation.data.locationId),
    await flash(request, success("Updated material planning"))
  );
}

export default function MateriallanningRoute() {
  const sharedMaterialsData = useRouteData<{
    locations: ListItem[];
  }>(path.to.materialRoot);

  const { materialPlanning, locationId } = useLoaderData<typeof loader>();

  if (!sharedMaterialsData)
    throw new Error("Could not load shared materials data");

  return (
    <VStack spacing={4} className="p-4">
      <ItemPlanningForm
        key={materialPlanning.itemId}
        initialValues={{
          ...materialPlanning,
          ...getCustomFields(materialPlanning.customFields)
        }}
        locations={sharedMaterialsData.locations ?? []}
        type="Material"
      />
      <ItemPlanningChart
        itemId={materialPlanning.itemId}
        locationId={locationId}
        safetyStock={
          materialPlanning.reorderingPolicy === "Demand-Based Reorder"
            ? (materialPlanning.demandAccumulationSafetyStock ?? 0)
            : undefined
        }
      />
    </VStack>
  );
}
