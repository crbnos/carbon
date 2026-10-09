// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import { serverFns } from "@carbon/server-functions";
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

/**
 * The companies a proposal runs for: only those with an accounting cutover.
 * The synthesizers write rental accruals and contract revenue rows for any
 * company they are pointed at, and a company with no cutover cannot post the
 * run (.ai/specs/implemented/2026-10-08-accounting-cutover.md).
 */
export function companiesToPropose<T extends { id: string }>(
  companies: T[],
  withCutoverIds: string[]
): T[] {
  const withCutover = new Set(withCutoverIds);
  return companies.filter((company) => withCutover.has(company.id));
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

      const withCutover = await fetchAllFromTable<{ id: string }>(
        serviceRole,
        "companySettings",
        "id",
        (query) => query.not("accountingCutoverDate", "is", null).order("id")
      );

      if (withCutover.error) {
        logger.error("Failed to get company settings", {
          error: withCutover.error
        });
        throw withCutover.error;
      }

      const proposing = companiesToPropose(
        companies.data,
        withCutover.data.map((settings) => settings.id)
      );

      if (proposing.length === 0) {
        logger.warn("No companies to propose revenue recognition runs for");
      }

      return proposing;
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

          // A posted run for the period does not stop a second proposal:
          // rows can fall due after it posted. Only a Draft does.
          const existing = await db
            .selectFrom("revenueRecognitionRun")
            .select("id")
            .where("companyId", "=", company.id)
            .where("periodEnd", "=", periodEnd)
            .where("status", "=", "Draft")
            .executeTakeFirst();

          if (existing) {
            logger.info(
              `Skipped ${company.name}: a draft run for ${periodEnd} already exists (${existing.id})`
            );
            return;
          }

          // Posting stays a human action in the ERP; this only drafts the run.
          const proposal = await serverFns
            .system({ db, companyId: company.id, userId: "system" })
            .invokeOrThrow("propose-revenue-recognition-run", { periodEnd });

          logger.info(
            proposal
              ? `Proposed ${proposal.runId} (${proposal.lineCount} lines) for ${company.name}`
              : `Nothing to recognize for ${company.name}`
          );
        });
      } catch (error) {
        logger.error(
          "Failed to propose revenue recognition run for company {company}",
          { company: company.name, companyId: company.id, error }
        );
        failed.push(company.id);
      }
    }

    return { scheduled: scheduled.length, failed };
  }
);
