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
    const insertToolPlanning = await upsertItemPlanning(client, {
      itemId,
      companyId,
      locationId,
      createdBy: userId,
    });

    if (insertToolPlanning.error) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(insertToolPlanning.error, "Failed to insert tool planning")
        )
      );
    }

    toolPlanning = await getItemPlanning(client, itemId, companyId, locationId);
    if (toolPlanning.error || !toolPlanning.data) {
      throw redirect(
        path.to.tool(itemId),
        await flash(
          request,
          error(toolPlanning.error, "Failed to load tool planning")
        )
      );
    }
  }

  return json({
    toolPlanning: toolPlanning.data,
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

  const updateToolPlanning = await upsertItemPlanning(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updateToolPlanning.error) {
    throw redirect(
      path.to.tool(itemId),
      await flash(
        request,
        error(updateToolPlanning.error, "Failed to update tool planning")
      )
    );
  }

  throw redirect(
    path.to.toolPlanningLocation(itemId, validation.data.locationId),
    await flash(request, success("Updated tool planning"))
  );
}

export default function ToolPlanningRoute() {
  const sharedToolsData = useRouteData<{
    locations: ListItem[];
  }>(path.to.toolRoot);

  const { toolPlanning } = useLoaderData<typeof loader>();

  if (!sharedToolsData) throw new Error("Could not load shared tools data");

  return (
    <ItemPlanningForm
      key={toolPlanning.itemId}
      initialValues={{
        ...toolPlanning,
        ...getCustomFields(toolPlanning.customFields),
      }}
      locations={sharedToolsData.locations ?? []}
      type="Tool"
    />
  );
}
