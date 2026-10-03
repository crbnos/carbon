// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getJobDatabaseClient } from "../../../db";
import {
  emailPostedInvoice,
  postSalesInvoiceUnattended,
  resolveInvoiceAutomation
} from "../../../invoicing/automate-invoice";
import { inngest } from "../../client";

/**
 * Posts (and emails) one drafted recurring invoice per its source's invoice
 * automation. Fired by Invoice Now / Sell to Customer for the invoices they
 * drafted, and by the invoice's Send action with `mode: "Post and Email"` to
 * retry a failed email. The daily recurring-billing job runs the same two
 * steps inline. One run per invoice at a time; both steps are idempotent.
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

    const mode =
      event.data.mode ??
      (await step.run("resolve-mode", () =>
        resolveInvoiceAutomation(client, companyId, invoiceId)
      ));
    if (!mode || mode === "Draft Only") return { mode, outcome: "skipped" };

    const posted = await step.run("post", () =>
      postSalesInvoiceUnattended({
        client,
        db: getJobDatabaseClient(),
        companyId,
        invoiceId
      })
    );
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
