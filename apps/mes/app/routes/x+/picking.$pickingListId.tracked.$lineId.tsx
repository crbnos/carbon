// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { userContext } from "~/context";
import { pickTrackedEntity } from "~/services/commands.picking.server";
import {
  getAvailableTrackedEntities,
  getCompanySettings,
  getPickOrder
} from "~/services/inventory.service";

const logger = getLogger("mes", "picking-tracked-line");

/**
 * GET: available tracked lots for a picking line (non-lineside, deduped),
 * smart-ordered for the TrackedEntityPicker. POST: pick/unpick a chosen lot.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const { lineId } = params;
  if (!lineId) throw new Response("Not found", { status: 404 });

  const lineResult = await client
    .from("pickingListLine")
    .select(
      "id, itemId, quantityToPick, quantityPicked, pickingList(locationId), item(itemTrackingType)"
    )
    .eq("id", lineId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (lineResult.error || !lineResult.data) {
    logger.warn("Picking line not found for company", {
      companyId,
      lineId,
      error: lineResult.error
    });
    throw new Response("Line not found", { status: 404 });
  }

  const line = lineResult.data;
  const locationId = (line.pickingList as { locationId: string } | null)
    ?.locationId;
  const trackingType =
    (line.item as { itemTrackingType: string } | null)?.itemTrackingType ??
    "Batch";

  const [entities, settings, defaultOrder] = await Promise.all([
    locationId
      ? getAvailableTrackedEntities(client, {
          itemId: line.itemId,
          companyId,
          locationId,
          excludeLineside: true,
          excludeAllocated: true,
          excludeLineId: lineId
        })
      : { data: [] },
    getCompanySettings(client, companyId),
    locationId
      ? getPickOrder(client, { itemId: line.itemId, locationId, companyId })
      : ("Default" as const)
  ]);
  const shelfLife = (settings.data?.inventoryShelfLife ?? {}) as {
    nearExpiryWarningDays?: number | null;
    expiredEntityPolicy?: "Warn" | "Block" | "BlockWithOverride";
  };

  return {
    entities: entities.data ?? [],
    trackingType,
    quantityRequired: Math.max(
      0,
      Number(line.quantityToPick ?? 0) - Number(line.quantityPicked ?? 0)
    ),
    nearExpiryWarningDays: shelfLife.nearExpiryWarningDays ?? 0,
    expiredEntityPolicy: shelfLife.expiredEntityPolicy ?? "Warn",
    defaultOrder
  };
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();

  const result = await pickTrackedEntity(
    serviceRole,
    { companyId, userId: effectiveUserId },
    {
      pickingListLineId: params.lineId,
      trackedEntityId: formData.get("trackedEntityId") as string,
      fromStorageUnitId: (formData.get("fromStorageUnitId") as string) || null,
      quantity: Number(formData.get("quantity") ?? 0),
      unpick: formData.get("unpick") === "true"
    }
  );

  if (!result.ok) {
    return { success: false, message: result.failure.message };
  }

  return { success: true, data: result.data };
}
