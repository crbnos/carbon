// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import { type ActionFunctionArgs, data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "receipt-void");

// The void modal submits through a fetcher and stays on this page, so a flash
// on a redirect back here is never shown. A refusal comes back as data and the
// modal shows its message.
export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  const refuse = (message: string, status = 400) =>
    data(error(null, message), { status });

  const { data: receipt, error: receiptError } = await client
    .from("receipt")
    .select("status, invoiced")
    .eq("id", receiptId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (receiptError) {
    logger.error("Failed to load the receipt to void", {
      companyId,
      receiptId,
      error: receiptError
    });
    return refuse("Failed to void receipt", 500);
  }
  if (!receipt) return refuse("Receipt not found", 404);
  if (receipt.status !== "Posted") {
    return refuse("Can only void posted receipts");
  }
  if (receipt.invoiced) {
    return refuse(
      "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
    );
  }

  const voidReceipt = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-receipt", { type: "void", receiptId });

  if (voidReceipt.error) {
    logger.error("Failed to void receipt", {
      companyId,
      receiptId,
      error: voidReceipt.error
    });
    // A refusal carries a message written for the user; a server failure
    // carries none.
    return refuse(
      voidReceipt.error.message || "Failed to void receipt",
      voidReceipt.error.status
    );
  }

  throw redirect(
    path.to.receiptDetails(receiptId),
    await flash(request, success("Receipt voided"))
  );
}
