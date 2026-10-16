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

  let toolPlanning = await getItemPlanning(
    client,
    itemId,
    companyId,
    locationId
  );

  if (toolPlanning.error || !toolPlanning.data) {
    throw redirect(
      path.to.tool(itemId),
      await flash(
        request,
        error(toolPlanning.error, "Failed to load tool planning")
      )
    );
  }

  return {
    toolPlanning: toolPlanning.data,
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
    path.to.toolPlanningLocation(itemId, input.data.locationId),
    { message: "Updated tool planning", onError: path.to.tool(itemId) }
  );
}

export default function ToolPlanningRoute() {
  const sharedToolsData = useRouteData<{
    locations: ListItem[];
  }>(path.to.toolRoot);

  const { toolPlanning, locationId } = useLoaderData<typeof loader>();

  if (!sharedToolsData) throw new Error("Could not load shared tools data");

  return (
    <VStack spacing={4} className="p-4">
      <ItemPlanningForm
        key={toolPlanning.itemId}
        initialValues={{
          ...toolPlanning,
          ...getCustomFields(toolPlanning.customFields)
        }}
        locations={sharedToolsData.locations ?? []}
        type="Tool"
      />
      <ItemPlanningChart itemId={toolPlanning.itemId} locationId={locationId} />
    </VStack>
  );
}
