// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  try {
    const serviceRole = getCarbonServiceRole();

    const { data: receipt } = await client
      .from("receipt")
      .select("status, invoiced")
      .eq("id", receiptId)
      .eq("companyId", companyId)
      .single();

    if (!receipt) {
      throw redirect(
        path.to.receipts,
        await flash(
          request,
          error(new Error("Receipt not found"), "Invalid operation")
        )
      );
    }

    if (receipt.status !== "Posted") {
      throw redirect(
        path.to.receiptDetails(receiptId),
        await flash(
          request,
          error(new Error("Can only void posted receipts"), "Invalid operation")
        )
      );
    }

    if (receipt.invoiced) {
      throw redirect(
        path.to.receiptDetails(receiptId),
        await flash(
          request,
          error(
            new Error(
              "Cannot void a receipt created by a purchase invoice. Void the invoice instead."
            ),
            "Invalid operation"
          )
        )
      );
    }

    const voidReceipt = await serviceRole.functions.invoke("post-receipt", {
      body: {
        type: "void",
        receiptId: receiptId,
        userId: userId,
        companyId: companyId
      }
    });

    if (voidReceipt.error) {
      throw redirect(
        path.to.receiptDetails(receiptId),
        await flash(request, error(voidReceipt.error, "Failed to void receipt"))
      );
    }

    return redirect(
      path.to.receiptDetails(receiptId),
      await flash(request, success("Receipt voided"))
    );
  } catch (err) {
    throw redirect(
      path.to.receiptDetails(receiptId),
      await flash(request, error(err, "Failed to void receipt"))
    );
  }
}
