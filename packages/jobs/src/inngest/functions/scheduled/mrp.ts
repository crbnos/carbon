import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllFromTable } from "@carbon/database";
import { Edition } from "@carbon/utils";
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

      // Enumerate `company`, never `companyPlan`. This used to read the
      // billing table, so every install where nobody completed Stripe checkout
      // — self-hosted, community, local dev — had an empty work list and MRP
      // silently never ran, with a green Inngest run to show for it.
      //
      // Paged with a stable order: PostgREST's max_rows caps a bare select at
      // 1000, which drops the tail of the work list the same silent way. The
      // dev stack does not enforce the cap, so the truncation is invisible
      // locally.
      const companies = await fetchAllFromTable<{ id: string; name: string }>(
        serviceRole,
        "company",
        "id, name",
        (query) => query.order("id")
      );

      if (companies.error) {
        logger.error("Failed to get companies", { error: companies.error });
        // Throw, never return: a return here is a step that SUCCEEDS having
        // planned for nobody — the exact failure mode this function was fixed
        // for. Throwing spends the two configured retries and shows red.
        throw companies.error;
      }

      // Cloud only: a cancelled subscription means the weekly job is about to
      // delete the company, so planning for it is wasted work. Everywhere else
      // there is nothing to check — MRP is not a paid feature.
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
          const result = await serviceRole.functions.invoke("mrp", {
            body: {
              type: "company",
              id: company.id,
              companyId: company.id,
              userId: "system"
            }
          });

          if (result.error) {
            logger.error(`Failed to run MRP for company ${company.name}`, {
              error: result.error
            });
          } else {
            logger.info(`Successfully ran MRP for company ${company.name}`);
          }
        } catch (error) {
          logger.error("Unexpected error in MRP run task", { error });
        }
      }
    });
  }
);
