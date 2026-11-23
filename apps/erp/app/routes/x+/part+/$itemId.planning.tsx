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
import { z } from "zod";
import { zfd } from "zod-form-data";
import { useRouteData } from "~/hooks";
import {
  itemPlanningValidator,
  itemSupersessionValidator,
  predecessorSupersessionValidator
} from "~/modules/items/items.models";
import {
  getItemPlanning,
  getItemQuantities,
  getItemSupersession,
  getSupersessionChain
} from "~/modules/items/items.service";
import {
  ItemPlanningForm,
  ItemSupersessionForm
} from "~/modules/items/ui/Item";
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
    supersededBy: supersessionChain.supersededBy,
    quantityOnHand: quantities.data?.quantityOnHand ?? 0,
    locationId
  };
}

// The planning form, the supersession card (`intent=supersession`) and its
// Add Predecessor modal (`intent=supersession-predecessor`).
const intentForm = z.object({ intent: zfd.text(z.string().optional()) });

export async function action(args: ActionFunctionArgs) {
  const input = await validator(intentForm).request(args, {
    params: ["itemId"]
  });
  if ("invalid" in input) return input.invalid;
  const { itemId } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);

  if (input.data.intent === "supersession") {
    const validation = await validator(itemSupersessionValidator).validate(
      formData
    );
    if (validation.error) return validationError(validation.error);
    const result = await api.items.setItemSupersession({
      ...validation.data,
      itemId
    });
    if (result.error?.category === "rule") {
      return validationError({
        fieldErrors: { successorItemId: result.error.message },
        formId: validation.formId
      });
    }
    const { locationId } = validation.data;
    return respond(args.request, result).redirect(
      locationId
        ? path.to.partPlanningLocation(itemId, locationId)
        : path.to.partPlanning(itemId),
      { message: "Updated supersession", onError: path.to.part(itemId) }
    );
  }

  if (input.data.intent === "supersession-predecessor") {
    const validation = await validator(
      predecessorSupersessionValidator
    ).validate(formData);
    if (validation.error) return validationError(validation.error);
    const result = await api.items.addItemPredecessor({
      ...validation.data,
      itemId
    });
    if (result.error && result.error.category !== "internal") {
      return validationError({
        fieldErrors: { predecessorItemId: result.error.message },
        formId: validation.formId
      });
    }
    return respond(args.request, result).redirect(
      path.to.partPlanning(itemId),
      { message: "Added predecessor" }
    );
  }

  const validation = await validator(itemPlanningValidator).validate(formData);
  if (validation.error) return validationError(validation.error);
  const result = await api.items.updateItemPlanning({
    ...validation.data,
    itemId,
    customFields: setCustomFields(formData)
  });
  if (result.error?.category === "rule") {
    return validationError({
      fieldErrors: { responsibleEmployee: result.error.message },
      formId: validation.formId
    });
  }
  return respond(args.request, result).redirect(
    path.to.partPlanningLocation(itemId, validation.data.locationId),
    { message: "Updated part planning", onError: path.to.part(itemId) }
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
    supersededBy,
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
    <VStack spacing={4} className="p-4">
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
        supersededBy={supersededBy}
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
