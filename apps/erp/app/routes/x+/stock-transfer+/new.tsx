import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteStockTransfer,
  stockTransferValidator,
  upsertStockTransfer,
  upsertStockTransferLines
} from "~/modules/inventory";
import {
  evaluateLinesForSurface,
  isBlocked
} from "~/modules/items/itemRules.server";
import { getNextSequence } from "~/modules/settings";
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

  const nextSequence = await getNextSequence(
    client,
    "stockTransfer",
    companyId
  );
  if (nextSequence.error) {
    throw redirect(
      path.to.stockTransfers,
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const { locationId, lines } = validation.data;
  const acknowledged = formData.get("acknowledged") === "true";

  // Item Rule pre-flight. Create-Transfer auto-releases (insert sets
  // status="Released"), so this is the gate where rules must fire before
  // any stock-moving is started. Evaluate against the destination side
  // (`toStorageUnitId`) — that's where stock will land.
  const serviceRole = getCarbonServiceRole();
  const { violations, ruleNames } = await evaluateLinesForSurface({
    client: serviceRole,
    companyId,
    userId,
    surface: "stockTransfer",
    lines: lines.map((l, i) => ({
      lineId: `pending-${i}`,
      itemId: l.itemId,
      storageUnitId: l.toStorageUnitId ?? null,
      quantity: Number(l.quantity ?? 0),
      locationId
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

  const linesWithExpandedSerialTracking = lines.reduce<typeof lines>(
    (acc, line) => {
      // If quantity contains a decimal, ignore the line (as per requirements)
      if (line.quantity && !Number.isInteger(line.quantity)) {
        return acc;
      }

      // If item requires serial tracking and quantity is a whole number > 1
      if (line.requiresSerialTracking && line.quantity && line.quantity > 1) {
        // Break out into multiple lines with quantity 1
        acc.push(
          ...Array.from({ length: line.quantity }, () => ({
            ...line,
            quantity: 1
          }))
        );
      } else {
        acc.push(line);
      }
      return acc;
    },
    []
  );

  const createStockTransfer = await upsertStockTransfer(client, {
    stockTransferId: nextSequence.data,
    locationId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createStockTransfer.error) {
    throw redirect(
      path.to.stockTransfers,
      await flash(
        request,
        error(createStockTransfer.error, "Failed to create stock transfer")
      )
    );
  }

  const createStockTransferLines = await upsertStockTransferLines(client, {
    lines: linesWithExpandedSerialTracking,
    stockTransferId: createStockTransfer.data.id,
    companyId,
    createdBy: userId
  });

  if (createStockTransferLines.error) {
    await deleteStockTransfer(client, createStockTransfer.data.id);
    throw redirect(
      path.to.stockTransfers,
      await flash(
        request,
        error(
          createStockTransferLines.error,
          "Failed to create stock transfer lines"
        )
      )
    );
  }

  throw redirect(path.to.stockTransfer(createStockTransfer.data.id));
}
