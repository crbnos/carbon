// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  getAvailableTrackedEntities,
  getPickOrder
} from "~/modules/inventory/inventory.service";
import { getCompanySettings } from "~/modules/settings/settings.service";

/**
 * GET: available tracked lots for a picking line (non-lineside, deduped),
 * smart-ordered for the TrackedEntityPicker. POST: pick/unpick a chosen lot.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const { lineId } = params;
  if (!lineId) throw new Response("Not found", { status: 404 });

  const lineResult = await client
    .from("pickingListLine")
    .select(
      "id, itemId, quantityToPick, quantityPicked, pickingList(locationId), item(itemTrackingType)"
    )
    .eq("id", lineId)
    .single();

  if (lineResult.error || !lineResult.data) {
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

const trackedPick = z.object({
  trackedEntityId: z.string().min(1, { message: "Missing tracked entity" }),
  fromStorageUnitId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number().min(0).default(0)),
  unpick: zfd.checkbox({ trueValue: "true" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(trackedPick).request(args, {
    params: ["pickingListId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;

  const api = await carbon(args.request);
  return api.inventory.pickPickingListLineEntity({
    pickingListId: input.params.pickingListId,
    pickingListLineId: input.params.lineId,
    ...input.data,
    fromStorageUnitId: input.data.fromStorageUnitId ?? null
  });
}
