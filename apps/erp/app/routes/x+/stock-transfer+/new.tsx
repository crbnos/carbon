import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  evaluateLinesForSurface,
  isBlocked
} from "@carbon/ee/storage-rules.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  insertStockTransfer,
  stockTransferValidator
} from "~/modules/inventory";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Stock Transfers`,
  to: path.to.stockTransfers
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(stockTransferValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { locationId, lines } = validation.data;
  const acknowledged = formData.get("acknowledged") === "true";

  // Item Rule pre-flight. Create-Transfer auto-releases (insert sets
  // status="Released"), so this is the gate where rules must fire before
  // any stock-moving is started. Evaluate against the destination side
  // (`toStorageUnitId`) — that's where stock will land.
  const serviceRole = getCarbonServiceRole();
  const evalLines = lines.map((l, i) => ({
    lineId: `pending-${i}`,
    itemId: l.itemId,
    storageUnitId: l.toStorageUnitId ?? null,
    quantity: Number(l.quantity ?? 0),
    locationId
  }));

  const { violations, ruleNames } = await evaluateLinesForSurface({
    client: serviceRole,
    companyId,
    userId,
    targetType: "item",
    surface: "stockTransfer",
    lines: evalLines
  });

  if (violations.length > 0 && isBlocked(violations, acknowledged)) {
    return {
      error: null,
      data: null,
      violations,
      ruleNames
    };
  }

  const createStockTransfer = await insertStockTransfer(client, {
    locationId,
    lines,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createStockTransfer.error || !createStockTransfer.data) {
    throw redirect(
      path.to.stockTransfers,
      await flash(
        request,
        error(createStockTransfer.error, "Failed to create stock transfer")
      )
    );
  }

  throw redirect(path.to.stockTransfer(createStockTransfer.data.id));
}
