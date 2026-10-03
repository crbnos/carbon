// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable } from "@carbon/database";
import { runMrp } from "@carbon/planning";
import { Edition } from "@carbon/utils";
import { fromAbsolute, now } from "@internationalized/date";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import {
  companiesWithPlanningWork,
  isMrpDue,
  mrpTick,
  selectCompaniesForMrp
} from "./mrp-companies";

export const mrpFunction = inngest.createFunction(
  { id: "mrp", retries: 2 },
  // Every MRP_TICK_MINUTES (mrp-companies.ts). Most ticks plan for nobody: a
  // company is due every 3 hours, or once a day at the time it set in
  // Settings → Production (`companySettings.mrpRunTime`) — see `isMrpDue`.
  { cron: "*/15 * * * *" },
  async ({ event, step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    const scheduled = await step.run("find-companies", async () => {
      // The slot this run was fired for. `event.ts` is the cron's own
      // timestamp and does not move on a retry; the clock is the fallback.
      const tick = mrpTick(
        event.ts === undefined ? now("UTC") : fromAbsolute(event.ts, "UTC")
      );

      // Only the companies that chose a time; everyone else is on the default.
      const runTimes = await fetchAllFromTable<{
        id: string;
        mrpRunTime: string;
      }>(serviceRole, "companySettings", "id, mrpRunTime", (query) =>
        query.not("mrpRunTime", "is", null).order("id")
      );

      if (runTimes.error) {
        // Throwing, not defaulting: without the run times every company looks
        // like it is on the 3-hour cadence, so a company that set a time would
        // be planned at the wrong hours and skipped at its own.
        logger.error("Failed to get MRP run times", { error: runTimes.error });
        throw runTimes.error;
      }

      // Most ticks fall between the 3-hourly runs, and with no company on a
      // daily time nobody can be due: stop before reading every company.
      if (
        runTimes.data.length === 0 &&
        !isMrpDue(tick, { timezone: "UTC", mrpRunTime: null })
      ) {
        return [];
      }

      // Enumerate `company`, never `companyPlan` — that billing table is empty
      // on every install where nobody completed Stripe checkout, and MRP
      // silently never ran there. Paged, because max_rows would truncate the
      // work list the same silent way.
      const companies = await fetchAllFromTable<{
        id: string;
        name: string;
        timezone: string;
      }>(serviceRole, "company", "id, name, timezone", (query) =>
        query.order("id")
      );

      if (companies.error) {
        logger.error("Failed to get companies", { error: companies.error });
        // Throwing, not returning: a return is a step that succeeds having
        // planned for nobody, and never spends the configured retries.
        throw companies.error;
      }

      const runTimeByCompany = new Map(
        runTimes.data.map((row) => [row.id, row.mrpRunTime])
      );
      const due = companies.data.filter((company) => {
        const mrpRunTime = runTimeByCompany.get(company.id) ?? null;
        try {
          return isMrpDue(tick, { timezone: company.timezone, mrpRunTime });
        } catch (error) {
          // An unreadable timezone or time must not cost the company its
          // planning, or every other company this tick: use the default.
          logger.error("Invalid MRP schedule for company {companyName}", {
            companyName: company.name,
            error,
            timezone: company.timezone,
            mrpRunTime
          });
          return isMrpDue(tick, { timezone: "UTC", mrpRunTime: null });
        }
      });

      if (due.length === 0) {
        // A tick between the 3-hourly runs that is nobody's daily time. Not a
        // warning, and not worth the plan and planning-work lookups below.
        return [];
      }

      // Cloud only: a cancelled subscription means the weekly job is about to
      // delete the company. MRP is not a paid feature anywhere else.
      let plans:
        | { id: string; stripeSubscriptionStatus: string | null }[]
        | null = null;
      if (process.env.CARBON_EDITION === Edition.Cloud) {
        const companyPlans = await fetchAllFromTable<{
          id: string;
          stripeSubscriptionStatus: string | null;
        }>(
          serviceRole,
          "companyPlan",
          "id, stripeSubscriptionStatus",
          (query) => query.order("id")
        );

        if (companyPlans.error) {
          // Deliberately not a return: leaving `plans` null plans for everyone.
          logger.error("Failed to get company plans, planning for all", {
            error: companyPlans.error
          });
        } else {
          plans = companyPlans.data;
        }
      }

      // Deliberately not a throw: a failed lookup plans for everyone.
      const withPlanningWork = await companiesWithPlanningWork(
        getJobDatabaseClient()
      ).catch((error) => {
        logger.error("Failed to find companies with planning work", { error });
        return null;
      });

      const scheduled = selectCompaniesForMrp(due, plans, withPlanningWork);
      logger.info("Companies scheduled for MRP", {
        tick: tick.toAbsoluteString(),
        companies: companies.data.length,
        due: due.length,
        scheduled: scheduled.length
      });

      if (scheduled.length === 0) {
        logger.warn("No companies to run MRP for", {
          companies: companies.data.length,
          due: due.length
        });
      }

      return scheduled;
    });

    // One step per company: each is its own invocation with its own retries
    // and is memoized on replay, so a slow or failing tenant costs only
    // itself. All companies in one step was one Vercel invocation, timed out
    // as the tenant count grew, and every retry restarted from company #1.
    // ponytail: 1000-step-per-run ceiling; fan out with step.sendEvent when
    // the company count nears it.
    const failed: string[] = [];
    for (const company of scheduled) {
      try {
        await step.run(`mrp-${company.id}`, async () => {
          // Run MRP in-process (Node); runMrp throws on failure.
          await runMrp(serviceRole, getJobDatabaseClient(), {
            type: "company",
            id: company.id,
            companyId: company.id,
            userId: "system"
          });
          logger.info(`Successfully ran MRP for company ${company.name}`);
        });
      } catch (error) {
        logger.error("Failed to run MRP for company {companyName}", {
          companyName: company.name,
          error
        });
        failed.push(company.id);
      }
    }

    return { companies: scheduled.length, failed };
  }
);
