import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  dedupeViolations,
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/custom-rules.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { warehouseTransferStatusType } from "~/modules/inventory";
import { updateWarehouseTransferStatus } from "~/modules/inventory/inventory.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof warehouseTransferStatusType)[number];
  const acknowledged = formData.get("acknowledged") === "true";

  if (!status || !warehouseTransferStatusType.includes(status)) {
    throw redirect(
      path.to.warehouseTransfer(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // Item Rule evaluation at every "go" transition — the user is committing to
  // the transfer plan. Pre-flight blocks early (before child shipment/receipt
  // are created). Cancel + Reopen are intentionally excluded — they're not
  // commits.
  const COMMITTING_STATUSES = new Set([
    "To Ship and Receive",
    "To Ship",
    "To Receive",
    "Completed"
  ]);
  if (COMMITTING_STATUSES.has(status)) {
    const serviceRole = getCarbonServiceRole();
    const { data: lines } = await serviceRole
      .from("warehouseTransferLine")
      .select(
        "id, itemId, fromStorageUnitId, toStorageUnitId, toLocationId, quantity"
      )
      .eq("transferId", id)
      .eq("companyId", companyId);

    const evalLines = (lines ?? []).map((l) => ({
      lineId: l.id as string,
      itemId: l.itemId as string | null,
      storageUnitId: l.toStorageUnitId as string | null,
      quantity: Number(l.quantity ?? 0),
      locationId: l.toLocationId as string | null
    }));

    const itemPass = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "item",
      surface: "warehouseTransfer",
      // Evaluate against the destination side — that's where stock is landing.
      lines: evalLines
    });

    const storagePass = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      targetType: "storageUnit",
      surface: "warehouseTransfer",
      lines: evalLines
    });

    const combined = dedupeViolations([
      ...itemPass.violations,
      ...storagePass.violations
    ]);
    const ruleNames = { ...itemPass.ruleNames, ...storagePass.ruleNames };

    if (combined.length > 0 && isBlocked(combined, acknowledged)) {
      return {
        error: null,
        data: null,
        violations: combined,
        ruleNames
      };
    }
  }

  const update = await updateWarehouseTransferStatus(id, status);

  if (update.error) {
    throw redirect(
      path.to.warehouseTransfer(id),
      await flash(
        request,
        error(update.error, "Failed to update warehouse transfer status")
      )
    );
  }

  throw redirect(
    path.to.warehouseTransfer(id),
    await flash(request, success("Updated warehouse transfer status"))
  );
}
