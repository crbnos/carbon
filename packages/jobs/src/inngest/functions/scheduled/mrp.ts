import { getCarbonServiceRole } from "@carbon/auth/client.server";
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
      const companies = await serviceRole.from("company").select("id, name");

      if (companies.error) {
        logger.error("Failed to get companies", { error: companies.error });
        return;
      }

      // Cloud only: a cancelled subscription means the weekly job is about to
      // delete the company, so planning for it is wasted work. Everywhere else
      // there is nothing to check — MRP is not a paid feature.
      let plans:
        | { id: string; stripeSubscriptionStatus: string | null }[]
        | null = null;
      if (process.env.CARBON_EDITION === Edition.Cloud) {
        const companyPlans = await serviceRole
          .from("companyPlan")
          .select("id, stripeSubscriptionStatus");

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
