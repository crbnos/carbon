// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId not found");

  try {
    const { data: purchaseInvoice } = await client
      .from("purchaseInvoice")
      .select("status, postingDate")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .single();

    if (!purchaseInvoice) {
      throw redirect(
        path.to.invoicingPurchasing,
        await flash(
          request,
          error(new Error("Purchase invoice not found"), "Invalid operation")
        )
      );
    }

    if (!purchaseInvoice.postingDate) {
      throw redirect(
        path.to.purchaseInvoiceDetails(invoiceId),
        await flash(
          request,
          error(
            new Error("Can only void posted purchase invoices"),
            "Invalid operation"
          )
        )
      );
    }

    if (purchaseInvoice.status === "Voided") {
      throw redirect(
        path.to.purchaseInvoiceDetails(invoiceId),
        await flash(
          request,
          error(
            new Error("Purchase invoice is already voided"),
            "Invalid operation"
          )
        )
      );
    }

    if (
      purchaseInvoice.status === "Paid" ||
      purchaseInvoice.status === "Partially Paid"
    ) {
      throw redirect(
        path.to.purchaseInvoiceDetails(invoiceId),
        await flash(
          request,
          error(
            new Error(
              "Cannot void a purchase invoice with payments applied. Reverse the payment first."
            ),
            "Invalid operation"
          )
        )
      );
    }

    const voidInvoice = await serverFns
      .system({ db: getDatabaseClient(), companyId, userId })
      .invoke("post-purchase-invoice", { type: "void", invoiceId: invoiceId });

    if (voidInvoice.error) {
      throw redirect(
        path.to.purchaseInvoiceDetails(invoiceId),
        await flash(
          request,
          error(voidInvoice.error, "Failed to void purchase invoice")
        )
      );
    }

    return redirect(
      path.to.purchaseInvoiceDetails(invoiceId),
      await flash(request, success("Purchase invoice voided"))
    );
  } catch (err) {
    throw redirect(
      path.to.purchaseInvoiceDetails(invoiceId),
      await flash(request, error(err, "Failed to void purchase invoice"))
    );
  }
}
