import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  insertManualInventoryAdjustment,
  inventoryAdjustmentValidator
} from "~/modules/inventory";
import {
  evaluateLinesForSurface,
  isBlocked
} from "~/modules/items/itemRules.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(inventoryAdjustmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }
  const { ...d } = validation.data;
  const acknowledged = formData.get("acknowledged") === "true";

  // Item Rule evaluation. Single synthetic line covering the adjustment.
  const serviceRole = getCarbonServiceRole();
  const { violations, ruleNames } = await evaluateLinesForSurface({
    client: serviceRole,
    companyId,
    userId,
    surface: "inventoryAdjustment",
    lines: [
      {
        lineId: itemId,
        itemId,
        storageUnitId: d.storageUnitId ?? null,
        quantity: Number(d.quantity ?? 0),
        locationId: d.locationId
      }
    ]
  });

  if (violations.length > 0 && isBlocked(violations, acknowledged)) {
    return {
      error: null,
      data: null,
      violations,
      ruleNames
    };
  }

  const itemLedger = await insertManualInventoryAdjustment(client, {
    ...d,
    companyId,
    createdBy: userId
  });

  if (itemLedger.error) {
    const flashMessage =
      itemLedger.error === "Insufficient quantity for negative adjustment"
        ? "Insufficient quantity for negative adjustment"
        : "Failed to create manual inventory adjustment";

    throw redirect(
      path.to.inventoryItem(itemId),
      await flash(request, error(itemLedger.error, flashMessage))
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.inventoryItem(itemId));
}
