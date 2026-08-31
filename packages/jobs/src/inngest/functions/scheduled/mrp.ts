import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable } from "@carbon/database";
import { runMrp } from "@carbon/ee/planning";
import { Edition } from "@carbon/utils";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import { selectCompaniesForMrp } from "./mrp-companies";

export const mrpFunction = inngest.createFunction(
  { id: "mrp", retries: 2 },
  { cron: "0 */3 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    await step.run("run-mrp-for-all-companies", async () => {
      logger.info(
        `Scheduled MRP Calculation Started: ${new Date().toISOString()}`
      );

      // Enumerate `company`, never `companyPlan` — that billing table is empty
      // on every install where nobody completed Stripe checkout, and MRP
      // silently never ran there. Paged, because max_rows would truncate the
      // work list the same silent way.
      const companies = await fetchAllFromTable<{ id: string; name: string }>(
        serviceRole,
        "company",
        "id, name",
        (query) => query.order("id")
      );

      if (companies.error) {
        logger.error("Failed to get companies", { error: companies.error });
        // Throwing, not returning: a return is a step that succeeds having
        // planned for nobody, and never spends the configured retries.
        throw companies.error;
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

      const scheduled = selectCompaniesForMrp(companies.data, plans);

      if (scheduled.length === 0) {
        logger.warn("No companies to run MRP for", {
          companies: companies.data.length
        });
        return;
      }

      for (const company of scheduled) {
        try {
          // Run MRP in-process (Node) instead of invoking the `mrp` edge
          // function; runMrp throws on failure.
          await runMrp(serviceRole, getJobDatabaseClient(), {
            type: "company",
            id: company.id,
            companyId: company.id,
            userId: "system"
          });
          logger.info(`Successfully ran MRP for company ${company.name}`);
        } catch (error) {
          logger.error(`Failed to run MRP for company ${company.name}`, {
            error
          });
        }
      }
    });
  }
);
