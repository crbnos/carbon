import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  stockTransferStatusType,
  updateStockTransferStatus
} from "~/modules/inventory";
import {
  evaluateLinesForSurface,
  isBlocked
} from "~/modules/items/itemRules.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof stockTransferStatusType)[number];
  const acknowledged = formData.get("acknowledged") === "true";

  if (!status || !stockTransferStatusType.includes(status)) {
    throw redirect(
      requestReferrer(request) ?? path.to.stockTransfer(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // Item Rule evaluation at "go" transitions — Released is the user's
  // commitment to the transfer plan; pre-flight here so violations surface
  // before any picking happens. Completed kept as a defense-in-depth gate.
  // Draft / In Progress excluded — Draft is editing, In Progress is auto-set
  // when picking begins (handled by the picking flow).
  const COMMITTING_STATUSES = new Set(["Released", "Completed"]);
  if (COMMITTING_STATUSES.has(status)) {
    const serviceRole = getCarbonServiceRole();
    const { data: lines } = await serviceRole
      .from("stockTransferLine")
      .select("id, itemId, fromStorageUnitId, toStorageUnitId, quantity")
      .eq("stockTransferId", id)
      .eq("companyId", companyId);

    const { violations, ruleNames } = await evaluateLinesForSurface({
      client: serviceRole,
      companyId,
      userId,
      surface: "stockTransfer",
      // Evaluate against the destination side — that's where stock is landing.
      lines: (lines ?? []).map((l) => ({
        lineId: l.id as string,
        itemId: l.itemId as string | null,
        storageUnitId: l.toStorageUnitId as string | null,
        quantity: Number(l.quantity ?? 0),
        locationId: null
      }))
    });

    if (violations.length > 0 && isBlocked(violations, acknowledged)) {
      return {
        error: null,
        data: null,
        violations,
        ruleNames
      };
    }
  }

  const update = await updateStockTransferStatus(client, {
    id,
    status,
    assignee: ["Completed"].includes(status) ? null : undefined,
    completedAt: ["Completed"].includes(status)
      ? new Date().toISOString()
      : null,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.stockTransfer(id),
      await flash(request, error(update.error, "Failed to update issue status"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.stockTransfer(id),
    await flash(request, success("Updated issue status"))
  );
}
