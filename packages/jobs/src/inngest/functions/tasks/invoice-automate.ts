// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getJobDatabaseClient } from "../../../db";
import {
  emailPostedInvoice,
  postSalesInvoiceUnattended,
  resolveInvoiceAutomation,
  sendPostedInvoiceViaStripe
} from "../../../invoicing/automate-invoice";
import { inngest } from "../../client";

/**
 * Posts (and emails, or sends via Stripe) one drafted recurring invoice per
 * its source's invoice automation. Fired by Invoice / Sell to Customer for the invoices they
 * drafted, and by the invoice's Send action with `resend: true` to retry a
 * failed send — through Stripe when that is the configured mode, else by
 * email. The daily recurring-billing job runs the same steps inline. One run
 * per invoice at a time; every step is idempotent.
 */
export const invoiceAutomateFunction = inngest.createFunction(
  {
    id: "invoice-automate",
    retries: 2,
    concurrency: { key: "event.data.invoiceId", limit: 1 }
  },
  { event: "carbon/invoice.automate" },
  async ({ event, step, logger }) => {
    const { companyId, invoiceId } = event.data;
    const client = getCarbonServiceRole();

    const configured =
      event.data.mode ??
      (await step.run("resolve-mode", () =>
        resolveInvoiceAutomation(client, companyId, invoiceId)
      ));
    // A resend is a person asking for the posted invoice to go out: through
    // Stripe when that is how this invoice is sent, otherwise by email — also
    // for a mode that never sends, or an invoice with no recurring source.
    const mode = event.data.resend
      ? configured === "Post and Send via Stripe"
        ? configured
        : "Post and Email"
      : configured;
    if (!mode || mode === "Draft Only") return { mode, outcome: "skipped" };

    const posted = await step.run("post", () =>
      postSalesInvoiceUnattended({
        client,
        db: getJobDatabaseClient(),
        companyId,
        invoiceId
      })
    );
    if (posted.outcome === "posted" && mode === "Post and Send via Stripe") {
      const sent = await step.run("stripe", () =>
        sendPostedInvoiceViaStripe({
          client,
          db: getJobDatabaseClient(),
          companyId,
          invoiceId
        })
      );
      return { mode, posted, sent };
    }
    if (posted.outcome !== "posted" || mode !== "Post and Email") {
      logger.info("Invoice automation finished", { invoiceId, ...posted });
      return { mode, posted };
    }

    const emailed = await step.run("email", () =>
      emailPostedInvoice({ client, companyId, invoiceId })
    );
    return { mode, posted, emailed };
  }
);
