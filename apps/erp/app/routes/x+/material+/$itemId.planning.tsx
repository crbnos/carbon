// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import { itemPlanningValidator } from "~/modules/items/items.models";
import { getItemPlanning } from "~/modules/items/items.service";
import { ItemPlanningForm } from "~/modules/items/ui/Item";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import { getLocationsList } from "~/modules/resources/resources.service";
import { getUserDefaults } from "~/modules/users/users.service";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(itemPlanningValidator).request(args, {
    params: ["itemId"]
  });
  if ("invalid" in input) return input.invalid;
  const { itemId } = input.params;
  const api = await carbon(args.request);
  const result = await api.items.updateItemPlanning({
    ...input.data,
    itemId,
    customFields: input.formData && setCustomFields(input.formData)
  });
  if (result.error?.category === "rule") {
    return validationError({
      fieldErrors: { responsibleEmployee: result.error.message }
    });
  }
  return respond(args.request, result).redirect(
    path.to.materialPlanningLocation(itemId, input.data.locationId),
    { message: "Updated material planning", onError: path.to.material(itemId) }
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
