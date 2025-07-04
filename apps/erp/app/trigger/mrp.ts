import { getCarbonServiceRole } from "@carbon/auth";
import { schedules } from "@trigger.dev/sdk/v3";
import { runMRP } from "~/modules/production/production.service";

const serviceRole = getCarbonServiceRole();

export const mrp = schedules.task({
  id: "mrp",
  // Run every 3 hours
  cron: "0 */3 * * *",
  run: async () => {
    console.log(
      `🕒 Scheduled MRP Calculation Started: ${new Date().toISOString()}`
    );

    const companies = await serviceRole.from("company").select("id, name");

    if (companies.error) {
      console.error(
        `❌ Failed to get companies: ${
          companies.error instanceof Error
            ? companies.error.message
            : String(companies.error)
        }`
      );
      return;
    }
    for await (const company of companies.data) {
      try {
        const users = await serviceRole
          .from("userToCompany")
          .select("userId")
          .eq("companyId", company.id)
          .limit(1);
        const userId = users.data?.[0]?.userId;
        if (!userId) {
          console.error(`❌ No user found for company ${company.id}`);
          continue;
        }
        const result = await runMRP(serviceRole, {
          type: "company",
          id: company.id,
          companyId: company.id,
          userId: userId,
        });
        if (result.error) {
          console.error(
            `❌ Failed to run MRP for company ${company.id}: ${
              result.error instanceof Error
                ? result.error.message
                : String(result.error)
            }`
          );
        } else {
          console.log(`✅ Successfully ran MRP for company ${company.name}`);
        }
      } catch (error) {
        console.error(
          `Unexpected error in MRP run task: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  },
});
