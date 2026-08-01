import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

/**
 * Daily close-automation pass (#1039). For each company with accounting enabled,
 * invokes the `period-close-automation` edge function, which (idempotently):
 *   - drafts prepaid-amortization journals for entries due today,
 *   - drafts recurring journals for templates due today and advances them,
 *   - posts the mirror reversal for accruals whose autoReverseOn has arrived.
 * Drafts are proposals — a human posts them (or JE approval applies); only the
 * auto-reversals post directly. Runs at 02:00 UTC, mirroring update-exchange-rates.
 */
export const periodCloseAutomationFunction = inngest.createFunction(
  { id: "period-close-automation", retries: 2 },
  { cron: "0 2 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    const companies = await step.run("fetch-accounting-companies", async () => {
      const result = await serviceRole
        .from("companySettings")
        .select("id")
        .eq("accountingEnabled", true);
      if (result.error) {
        logger.error("Failed to fetch companies for close automation", {
          error: result.error
        });
        return [] as { id: string }[];
      }
      return result.data ?? [];
    });

    for (const company of companies) {
      await step.run(`close-automation-${company.id}`, async () => {
        const result = await serviceRole.functions.invoke(
          "period-close-automation",
          { body: { companyId: company.id, userId: "system" } }
        );
        if (result.error) {
          logger.error(`Close automation failed for company ${company.id}`, {
            error: result.error
          });
        } else {
          logger.info(`Close automation ran for company ${company.id}`, {
            result: result.data
          });
        }
        return result.data ?? null;
      });
    }
  }
);
