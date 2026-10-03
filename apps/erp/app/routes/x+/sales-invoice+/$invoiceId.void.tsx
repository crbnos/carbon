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
    // Verify invoice is posted before allowing void
    const { data: salesInvoice } = await client
      .from("salesInvoice")
      .select("status, postingDate")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .single();

    if (!salesInvoice) {
      throw redirect(
        path.to.invoicingSales,
        await flash(
          request,
          error(new Error("Sales invoice not found"), "Invalid operation")
        )
      );
    }

    if (!salesInvoice.postingDate) {
      throw redirect(
        path.to.salesInvoiceDetails(invoiceId),
        await flash(
          request,
          error(new Error("Can only void posted invoices"), "Invalid operation")
        )
      );
    }

    const voidInvoice = await serverFns
      .system({ db: getDatabaseClient(), companyId, userId })
      .invoke("post-sales-invoice", { type: "void", invoiceId });

    if (voidInvoice.error) {
      throw redirect(
        path.to.salesInvoiceDetails(invoiceId),
        await flash(
          request,
          error(voidInvoice.error, "Failed to void sales invoice")
        )
      );
    }

    return redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(request, success("Sales invoice voided"))
    );
  } catch (err) {
    throw redirect(
      path.to.salesInvoiceDetails(invoiceId),
      await flash(request, error(err, "Failed to void sales invoice"))
    );
  }
}
