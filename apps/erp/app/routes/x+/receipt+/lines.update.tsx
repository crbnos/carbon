// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { datetime, unchecked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { reconcileReceiptSerialsInTransaction } from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";

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
  if (field === "receivedQuantity") {
    if (ids.length === 0) return { error: null, data: null };
    if (!value) {
      return {
        error: { message: "Received quantity is required" },
        data: null
      };
    }
    // Drop serials beyond the new quantity in the same transaction.
    try {
      await getDatabaseClient()
        .transaction()
        .execute(async (trx) => {
          const lines = await trx
            .updateTable("receiptLine")
            .set({
              receivedQuantity: Number(value),
              updatedBy: userId,
              updatedAt: datetime.timestamp()
            })
            .where("id", "in", ids)
            .where("companyId", "=", companyId)
            .returning([
              "id",
              "receiptId",
              "receivedQuantity",
              "requiresSerialTracking"
            ])
            .execute();

          const receipts = await trx
            .selectFrom("receipt")
            .select(["id", "sourceDocument"])
            .where("id", "in", [...new Set(lines.map((l) => l.receiptId))])
            .where("companyId", "=", companyId)
            .where("status", "=", "Draft")
            .execute();

          for (const receipt of receipts) {
            await reconcileReceiptSerialsInTransaction(trx, {
              receiptId: receipt.id,
              companyId,
              isSalesReturn: receipt.sourceDocument === "Sales Return Order",
              lines: lines.filter((l) => l.receiptId === receipt.id)
            });
          }
        });
    } catch (error) {
      logger.error("Failed to update the received quantity", {
        companyId,
        ids,
        error
      });
      return {
        error: { message: "Failed to update the received quantity" },
        data: null
      };
    }
    return { error: null, data: null };
  }

  return client
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
}
