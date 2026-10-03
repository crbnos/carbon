// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import {
  createRentalInvoicesForDuePeriods,
  type DraftedRentalInvoice
} from "@carbon/database/rental-billing";
import { NotificationEvent } from "@carbon/notifications";
import { datetime } from "@carbon/utils";
import { getJobDatabaseClient } from "../../../db";
import {
  emailPostedInvoice,
  postSalesInvoiceUnattended
} from "../../../invoicing/automate-invoice";
import {
  buildRecurringInvoicingDigests,
  type InvoiceRunResult
} from "../../../invoicing/digest";
import { inngest } from "../../client";

/**
 * The one daily job for every recurring-invoice source — rental agreements
 * today, AR contracts later (.ai/specs/2026-10-02-contracts.md): draft what is
 * due, run invoice automation over the drafts, and send each owner one digest.
 */
export const recurringBillingFunction = inngest.createFunction(
  { id: "recurring-billing", retries: 2 },
  // Unlike the month-end proposal, no hour can pick the WRONG period here: the
  // job bills everything due on or before the company's local today, so the
  // hour only decides how soon after its due date a period is drafted — within
  // a day in every zone. 05:00 UTC is early morning in Europe and late evening
  // the day before in the Americas; a period missed today is billed tomorrow.
  { cron: "0 5 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const scheduled = await step.run("find-companies", async () => {
      logger.info(
        `Scheduled recurring billing started: ${datetime.timestamp()}`
      );

      // One query for every company with an Active agreement, rather than a
      // step per company that then finds nothing to bill. Kysely is not
      // subject to PostgREST's max_rows, so the list is never truncated.
      const companies = await getJobDatabaseClient()
        .selectFrom("rentalAgreement as ra")
        .innerJoin("company as c", "c.id", "ra.companyId")
        .select(["c.id", "c.name"])
        .where("ra.status", "=", "Active")
        .distinct()
        .orderBy("c.id")
        .execute();

      if (companies.length === 0) {
        logger.info("No companies with Active rental agreements");
      }

      return companies;
    });

    // One step per company: each is its own invocation with its own retries
    // and is memoized on replay, so a slow or failing tenant costs only
    // itself. A retry is safe: billed periods and charges are stamped with
    // their invoice line, so a second pass for the same day drafts nothing new.
    const failed: string[] = [];
    for (const company of scheduled) {
      let invoices: DraftedRentalInvoice[];
      try {
        ({ invoices } = await step.run(
          `rental-billing-${company.id}`,
          async () => {
            // The cron is UTC; "due" is judged on the company's own calendar.
            const tz = await getCompanyTimeZone(serviceRole, company.id);
            const asOf = datetime.today(tz).toString();

            const drafted = await createRentalInvoicesForDuePeriods(
              getJobDatabaseClient(),
              { companyId: company.id, asOf, userId: "system" }
            );

            logger.info(
              drafted.invoices.length > 0
                ? `Drafted ${drafted.invoices.length} rental invoice(s) for ${company.name} as of ${asOf}: ${drafted.invoiceIds.join(", ")}`
                : `Nothing due for ${company.name} as of ${asOf}`
            );

            return { asOf, invoices: drafted.invoices };
          }
        ));
      } catch (error) {
        logger.error(`Failed to bill rentals for company ${company.name}`, {
          error
        });
        failed.push(company.id);
        continue;
      }

      // Drafts, then posts and emails per the agreement's invoice automation
      // (spec 2026-10-02-rental-invoice-automation). Draft Only drafts wait
      // for a person and are not reported; a draft the planner held is.
      const results: InvoiceRunResult[] = [];
      for (const invoice of invoices) {
        if (invoice.mode === "Draft Only") continue;
        const result = (outcome: InvoiceRunResult["outcome"]) =>
          results.push({
            invoiceId: invoice.invoiceId,
            sourceId: invoice.rentalAgreementId,
            outcome
          });
        if (invoice.holdReason) {
          result("held");
          continue;
        }

        try {
          const posted = await step.run(`post-${invoice.invoiceId}`, () =>
            postSalesInvoiceUnattended({
              client: serviceRole,
              companyId: company.id,
              invoiceId: invoice.invoiceId
            })
          );
          if (posted.outcome === "skipped") continue;
          if (posted.outcome === "held") {
            result("held");
            continue;
          }
          if (invoice.mode !== "Post and Email") {
            result("posted");
            continue;
          }

          const emailed = await step.run(`email-${invoice.invoiceId}`, () =>
            emailPostedInvoice({
              client: serviceRole,
              companyId: company.id,
              invoiceId: invoice.invoiceId
            })
          );
          result(
            emailed.emailed
              ? "emailed"
              : emailed.sendError
                ? "unsent"
                : "posted"
          );
        } catch (error) {
          // Its state is uncertain, so a person should look at it.
          logger.error(`Failed to automate invoice ${invoice.invoiceId}`, {
            error
          });
          result("held");
        }
      }

      if (results.length === 0) continue;

      try {
        const recipients = await step.run(
          `digest-recipients-${company.id}`,
          async () => {
            const db = getJobDatabaseClient();
            const agreementIds = [...new Set(results.map((r) => r.sourceId))];
            const [agreements, settings] = await Promise.all([
              db
                .selectFrom("rentalAgreement")
                .select(["id", "salesPersonId", "createdBy"])
                .where("companyId", "=", company.id)
                .where("id", "in", agreementIds)
                .execute(),
              db
                .selectFrom("companySettings")
                .select("invoiceNotificationGroup")
                .where("id", "=", company.id)
                .executeTakeFirst()
            ]);

            // The owner is the salesperson, else the creator — when they can
            // still be notified in this company.
            const ownerOf = agreements
              .map((a) => ({ id: a.id, owner: a.salesPersonId ?? a.createdBy }))
              .filter((a) => a.owner && a.owner !== "system");
            const ownerIds = [...new Set(ownerOf.map((a) => a.owner))];
            const members =
              ownerIds.length > 0
                ? await db
                    .selectFrom("userToCompany")
                    .select("userId")
                    .where("companyId", "=", company.id)
                    .where("userId", "in", ownerIds)
                    .execute()
                : [];
            const memberIds = new Set(members.map((m) => m.userId));

            return {
              owners: ownerOf
                .filter((a) => memberIds.has(a.owner))
                .map((a) => [a.id, a.owner] as [string, string]),
              groupIds: settings?.invoiceNotificationGroup ?? []
            };
          }
        );

        const digests = buildRecurringInvoicingDigests(
          results,
          new Map(recipients.owners),
          recipients.groupIds
        );
        for (const digest of digests) {
          const key =
            digest.recipient.type === "user"
              ? digest.recipient.userId
              : "group";
          await step.sendEvent(
            `notify-recurring-invoicing-${company.id}-${key}`,
            {
              name: "carbon/notify",
              data: {
                event: NotificationEvent.RecurringInvoicing,
                companyId: company.id,
                documentIds: digest.documentIds,
                recipient: digest.recipient,
                body: digest.body
              }
            }
          );
        }
      } catch (error) {
        logger.error(
          `Failed to send the recurring invoicing digest for ${company.name}`,
          { error }
        );
      }
    }

    return { scheduled: scheduled.length, failed };
  }
);
