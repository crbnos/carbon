import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { userContext } from "~/context";
import {
  getAvailableTrackedEntities,
  getCompanySettings,
  getPickOrder
} from "~/services/inventory.service";
import { setPickingListLineTrackedEntity } from "~/services/picking.service";

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

  const entities = locationId
    ? await getAvailableTrackedEntities(client, {
        itemId: line.itemId,
        companyId,
        locationId,
        excludeLineside: true,
        excludeAllocated: true,
        excludeLineId: lineId
      })
    : { data: [] };

  const settings = await getCompanySettings(client, companyId);
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
    defaultOrder: locationId
      ? await getPickOrder(client, {
          itemId: line.itemId,
          locationId,
          companyId
        })
      : "Default"
  };
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const { lineId } = params;
  if (!lineId) return { success: false, message: "Missing line" };

  const formData = await request.formData();
  const trackedEntityId = formData.get("trackedEntityId") as string;
  const fromStorageUnitId =
    (formData.get("fromStorageUnitId") as string) || null;
  const quantity = Number(formData.get("quantity") ?? 0);
  const unpick = formData.get("unpick") === "true";

  if (!trackedEntityId) {
    return { success: false, message: "Missing tracked entity" };
  }

  const result = await setPickingListLineTrackedEntity(serviceRole, {
    pickingListLineId: lineId,
    trackedEntityId,
    fromStorageUnitId,
    quantity,
    unpick,
    userId: effectiveUserId
  });

  if (result.error) {
    return {
      success: false,
      message:
        typeof result.error === "string"
          ? result.error
          : (result.error.message ?? "Failed to pick line")
    };
  }

  return { success: true, data: result.data };
}
