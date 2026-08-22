import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { runMrp } from "@carbon/ee/planning";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

export const mrpFunction = inngest.createFunction(
  { id: "mrp", retries: 2 },
  { cron: "0 */3 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();
    await step.run("run-mrp-for-all-companies", async () => {
      logger.info(
        `Scheduled MRP Calculation Started: ${new Date().toISOString()}`
      );

      const companies = await serviceRole
        .from("companyPlan")
        .select("id, ...company(name)");

      if (companies.error) {
        logger.error("Failed to get companies", { error: companies.error });
        return;
      }

      for (const company of companies.data) {
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
