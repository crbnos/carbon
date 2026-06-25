import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getItemPlanning,
  getItemQuantities,
  getItemSupersession,
  getSupersessionChain,
  itemPlanningValidator,
  itemSupersessionValidator,
  upsertItemPlanning,
  upsertItemSupersession
} from "~/modules/items";
import {
  ItemPlanningForm,
  ItemSupersessionForm
} from "~/modules/items/ui/Item";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
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

  const [partPlanning, supersession, supersessionChain, quantities] =
    await Promise.all([
      getItemPlanning(client, itemId, companyId, locationId),
      getItemSupersession(client, itemId, companyId),
      getSupersessionChain(client, itemId, companyId),
      getItemQuantities(client, itemId, companyId, locationId)
    ]);

  if (partPlanning.error || !partPlanning.data) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(partPlanning.error, "Failed to load part planning")
      )
    );
  }

  return {
    partPlanning: partPlanning.data,
    supersession: supersession.data,
    supersessionChain: supersessionChain.chain,
    quantityOnHand: quantities.data?.quantityOnHand ?? 0,
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

  if (formData.get("intent") === "supersession") {
    const supersessionValidation = await validator(
      itemSupersessionValidator
    ).validate(formData);

    if (supersessionValidation.error) {
      return validationError(supersessionValidation.error);
    }

    const updateSupersession = await upsertItemSupersession(client, {
      ...supersessionValidation.data,
      itemId,
      companyId,
      createdBy: userId,
      updatedBy: userId
    });
    if (updateSupersession.error) {
      throw redirect(
        path.to.part(itemId),
        await flash(
          request,
          error(updateSupersession.error, "Failed to update supersession")
        )
      );
    }

    throw redirect(
      supersessionValidation.data.locationId
        ? path.to.partPlanningLocation(
            itemId,
            supersessionValidation.data.locationId
          )
        : path.to.partPlanning(itemId),
      await flash(request, success("Updated supersession"))
    );
  }

  const validation = await validator(itemPlanningValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePartPlanning = await upsertItemPlanning(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
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

  const {
    partPlanning,
    supersession,
    supersessionChain,
    quantityOnHand,
    locationId
  } = useLoaderData<typeof loader>();

  // partSummary (with the readable id) lives on the part layout route, not the
  // parts list root.
  const partLayoutData = useRouteData<{
    partSummary?: { readableIdWithRevision?: string | null } | null;
  }>(path.to.part(partPlanning.itemId));

  if (!sharedPartsData) throw new Error("Could not load shared parts data");

  return (
    <VStack spacing={2} className="p-2">
      <ItemPlanningForm
        key={partPlanning.itemId}
        initialValues={{
          ...partPlanning,
          ...getCustomFields(partPlanning.customFields)
        }}
        locations={sharedPartsData.locations ?? []}
        type="Part"
      />
      <ItemSupersessionForm
        key={`supersession:${partPlanning.itemId}`}
        initialValues={{
          itemId: partPlanning.itemId,
          supersessionMode: supersession?.supersessionMode ?? undefined,
          successorItemId: supersession?.successorItemId ?? undefined,
          discontinuationDate: supersession?.discontinuationDate ?? undefined,
          successorEffectivityDate:
            supersession?.successorEffectivityDate ?? undefined,
          conversionFactor: supersession?.conversionFactor ?? 1,
          locationId,
          minimumReserveQuantity: partPlanning.minimumReserveQuantity ?? 0
        }}
        type="Part"
        locationId={locationId}
        itemReadableId={
          partLayoutData?.partSummary?.readableIdWithRevision ??
          partPlanning.itemId
        }
        quantityOnHand={quantityOnHand}
        chain={supersessionChain}
      />
      <ItemPlanningChart
        itemId={partPlanning.itemId}
        locationId={locationId}
        safetyStock={
          partPlanning.reorderingPolicy === "Demand-Based Reorder"
            ? (partPlanning.demandAccumulationSafetyStock ?? 0)
            : undefined
        }
      />
    </VStack>
  );
}
