import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import { createRentalInvoicesForDuePeriods } from "@carbon/database/rental-billing";
import { datetime } from "@carbon/utils";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

export const rentalBillingFunction = inngest.createFunction(
  { id: "rental-billing", retries: 2 },
  // Unlike the month-end proposal, no hour can pick the WRONG period here: the
  // job bills everything due on or before the company's local today, so the
  // hour only decides how soon after its due date a period is drafted — within
  // a day in every zone. 05:00 UTC is early morning in Europe and late evening
  // the day before in the Americas; a period missed today is billed tomorrow.
  { cron: "0 5 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const scheduled = await step.run("find-companies", async () => {
      logger.info(`Scheduled rental billing started: ${datetime.timestamp()}`);

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
      try {
        await step.run(`rental-billing-${company.id}`, async () => {
          // The cron is UTC; "due" is judged on the company's own calendar.
          const tz = await getCompanyTimeZone(serviceRole, company.id);
          const asOf = datetime.today(tz).toString();

          // Posting stays a human action in the ERP; this only drafts invoices.
          const { invoiceIds } = await createRentalInvoicesForDuePeriods(
            getJobDatabaseClient(),
            { companyId: company.id, asOf, userId: "system" }
          );

          logger.info(
            invoiceIds.length > 0
              ? `Drafted ${invoiceIds.length} rental invoice(s) for ${company.name} as of ${asOf}: ${invoiceIds.join(", ")}`
              : `Nothing due for ${company.name} as of ${asOf}`
          );

          return { asOf, invoiceIds };
        });
      } catch (error) {
        logger.error(`Failed to bill rentals for company ${company.name}`, {
          error
        });
        failed.push(company.id);
      }
    }

    return { scheduled: scheduled.length, failed };
  }
);
