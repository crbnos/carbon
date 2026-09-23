import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import { createRevenueRecognitionRunProposal } from "@carbon/database/revenue-recognition";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * The last day of the month before the one `today` (`YYYY-MM-DD`) falls in,
 * as `YYYY-MM-DD`. Calendar arithmetic only — never a JS Date — so a leap
 * February and a 30-day month both come out right.
 */
export function priorMonthEnd(today: string): string {
  return parseDate(today).set({ day: 1 }).subtract({ days: 1 }).toString();
}

export const revenueRecognitionProposalFunction = inngest.createFunction(
  { id: "revenue-recognition-proposal", retries: 2 },
  // Noon UTC on the 1st: every inhabited zone (UTC-11 … UTC+14) is already on
  // the 1st or 2nd, so priorMonthEnd() names the month that just closed. At
  // 06:00 UTC a Pacific-time company would still be on the last day of the
  // prior month and be proposed a run for the month before that.
  { cron: "0 12 1 * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const scheduled = await step.run("find-companies", async () => {
      logger.info(
        `Scheduled revenue recognition proposal started: ${datetime.timestamp()}`
      );

      // Enumerate `company`, never `companyPlan` — that billing table is empty
      // on every install where nobody completed Stripe checkout (see mrp.ts).
      // Paged, because max_rows would truncate the work list the same silent
      // way.
      const companies = await fetchAllFromTable<{ id: string; name: string }>(
        serviceRole,
        "company",
        "id, name",
        (query) => query.order("id")
      );

      if (companies.error) {
        logger.error("Failed to get companies", { error: companies.error });
        // Throwing, not returning: a return is a step that succeeds having
        // proposed for nobody, and never spends the configured retries.
        throw companies.error;
      }

      if (companies.data.length === 0) {
        logger.warn("No companies to propose revenue recognition runs for");
      }

      return companies.data;
    });

    // One step per company: each is its own invocation with its own retries
    // and is memoized on replay, so a slow or failing tenant costs only
    // itself.
    const failed: string[] = [];
    for (const company of scheduled) {
      try {
        await step.run(`rev-rec-${company.id}`, async () => {
          // The cron is UTC; the period is the month that just ended on the
          // company's own calendar.
          const tz = await getCompanyTimeZone(serviceRole, company.id);
          const periodEnd = priorMonthEnd(datetime.today(tz).toString());
          const db = getJobDatabaseClient();

          const existing = await db
            .selectFrom("revenueRecognitionRun")
            .select("id")
            .where("companyId", "=", company.id)
            .where("periodEnd", "=", periodEnd)
            .executeTakeFirst();

          if (existing) {
            logger.info(
              `Skipped ${company.name}: a run for ${periodEnd} already exists (${existing.id})`
            );
            return;
          }

          // Posting stays a human action in the ERP; this only drafts the run.
          const proposal = await createRevenueRecognitionRunProposal(db, {
            companyId: company.id,
            periodEnd,
            userId: "system"
          });

          logger.info(
            proposal
              ? `Proposed ${proposal.runId} (${proposal.lineCount} lines) for ${company.name}`
              : `Nothing to recognize for ${company.name}`
          );
        });
      } catch (error) {
        logger.error(
          `Failed to propose revenue recognition run for company ${company.name}`,
          { error }
        );
        failed.push(company.id);
      }
    }

    return { scheduled: scheduled.length, failed };
  }
);
