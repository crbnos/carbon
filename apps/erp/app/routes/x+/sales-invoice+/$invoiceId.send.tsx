// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "sales-invoice-send");

// Re-sends a posted invoice whose automated email failed. The automate job
// skips posting an already-posted invoice and goes straight to the email.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const invoice = await client
    .from("salesInvoice")
    .select("id, status, postingDate, sentAt")
    .eq("id", invoiceId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (invoice.error || !invoice.data) {
    logger.error("Sales invoice not found", {
      companyId,
      invoiceId,
      error: invoice.error
    });
    throw new Response("Sales invoice not found", { status: 404 });
  }

  const redirectTo =
    requestReferrer(request) ?? path.to.salesInvoiceDetails(invoiceId);

  // Posted, as the header reads it: has a posting date and is not voided.
  if (!invoice.data.postingDate || invoice.data.status === "Voided") {
    throw redirect(
      redirectTo,
      await flash(request, error(null, "Only a posted invoice can be sent"))
    );
  }

  if (invoice.data.sentAt) {
    throw redirect(
      redirectTo,
      await flash(request, error(null, "This invoice has already been emailed"))
    );
  }

  try {
    await trigger("invoice-automate", {
      companyId,
      invoiceId,
      mode: "Post and Email"
    });
  } catch (err) {
    logger.error("Failed to queue invoice send", {
      companyId,
      invoiceId,
      error: err
    });
    throw redirect(
      redirectTo,
      await flash(request, error(err, "Failed to send invoice"))
    );
  }

  throw redirect(redirectTo, await flash(request, success("Sending invoice")));
}
