// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { unchecked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { reconcileReceiptSerialEntities } from "~/modules/inventory";

const logger = getLogger("erp", "receipt", "lines-update");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids") as string[];
  const field = formData.get("field");
  const value = formData.get("value");

  if (
    typeof field !== "string" ||
    (typeof value !== "string" && value !== null)
  ) {
    return { error: { message: "Invalid form data" }, data: null };
  }

  if (field !== "storageUnitId" && field !== "receivedQuantity") {
    return { error: { message: `Invalid field: ${field}` }, data: null };
  }

  // Storage Rule evaluation runs at post time only (`$receiptId.post.tsx`).
  // Per-line saves go straight through.
  const update = await client
    .from("receiptLine")
    .update(
      unchecked({
        [field]: value ? value : null,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .in("id", ids)
    .eq("companyId", companyId);

  // A lower received quantity drops serial boxes from the page; drop the
  // serials saved for them too. Left in place, raising the quantity again
  // showed an empty box while the old serial was still saved and posted.
  if (field === "receivedQuantity" && !update.error) {
    const { data: lines, error: linesError } = await client
      .from("receiptLine")
      .select(
        "id, receiptId, receivedQuantity, requiresSerialTracking, receipt(status, sourceDocument)"
      )
      .in("id", ids)
      .eq("companyId", companyId);
    if (linesError) {
      logger.error("Failed to load receipt lines for serial cleanup", {
        companyId,
        ids,
        error: linesError
      });
    }

    // Only a Draft receipt: a posted one's serials are its record.
    const serialLines = (lines ?? []).filter(
      (l) => l.requiresSerialTracking && l.receipt?.status === "Draft"
    );
    for (const receiptId of new Set(serialLines.map((l) => l.receiptId))) {
      const receiptLines = serialLines.filter((l) => l.receiptId === receiptId);
      const reconciled = await reconcileReceiptSerialEntities(
        getCarbonServiceRole(),
        {
          receiptId,
          companyId,
          isSalesReturn:
            receiptLines[0]?.receipt?.sourceDocument === "Sales Return Order",
          lines: receiptLines
        }
      );
      if (reconciled.error) {
        logger.error("Failed to remove serials beyond the received quantity", {
          companyId,
          receiptId,
          error: reconciled.error
        });
      }
    }
  }

  return update;
}
