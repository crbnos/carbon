import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/storage-rules.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  insertManualInventoryAdjustment,
  inventoryAdjustmentValidator
} from "~/modules/inventory";
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

  // Business rule evaluation. Item rules fire on the `inventoryAdjustment`
  // surface, and on `place` when the adjustment lands stock in a bin (positive
  // delta) or `pick` when it removes from a bin (negative delta) — so bin-level
  // rules tied to those surfaces also kick in for manual adjustments.
  const serviceRole = getCarbonServiceRole();
  const qty = Number(d.quantity ?? 0);
  const evalLine = [
    {
      lineId: itemId,
      itemId,
      storageUnitId: d.storageUnitId ?? null,
      quantity: qty,
      locationId: d.locationId
    }
  ];

  const itemPass = await evaluateLinesForSurface({
    client: serviceRole,
    companyId,
    userId,
    targetType: "item",
    surface: "inventoryAdjustment",
    lines: evalLine
  });

  const allViolations = [...itemPass.violations];
  const allRuleNames: Record<string, string> = { ...itemPass.ruleNames };

  if (d.storageUnitId) {
    // Pick the bin surface from `adjustmentType` only. `quantity` is a
    // positive magnitude per `inventoryAdjustmentValidator` — sign-based
    // direction detection would misclassify `Negative Adjmt.` as `place`.
    // Item rules own the `place`/`pick` surfaces.
    const isNegative = d.adjustmentType === "Negative Adjmt.";
    const binSurface: "place" | "pick" = isNegative ? "pick" : "place";

    const binPass = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "item",
      surface: binSurface,
      lines: evalLine
    });
    allViolations.push(...binPass.violations);
    Object.assign(allRuleNames, binPass.ruleNames);
  }

  const deduped = dedupeViolations(allViolations);

  if (deduped.length > 0 && isBlocked(deduped, acknowledged)) {
    return {
      error: null,
      data: null,
      violations: deduped,
      ruleNames: allRuleNames
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
        : itemLedger.error === "Serial number not found"
          ? "Serial number not found"
          : "Failed to create manual inventory adjustment";

    throw redirect(
      path.to.inventoryItem(itemId),
      await flash(request, error(itemLedger.error, flashMessage))
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.inventoryItem(itemId));
}
