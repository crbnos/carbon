/**
 * Ramp inbound sweep — the correctness guarantee behind the webhook-driven
 * pulls. Webhooks are latency; this hourly sweep is correctness: any missed or
 * disabled webhook delivery becomes ≤1h of staleness instead of permanent loss.
 *
 * Every hour it lists each company with an ACTIVE Ramp integration and fires one
 * `carbon/ramp-sync` event per company (`reason: "sweep"`). `ramp-sync` itself
 * is idempotent (mapping-guarded, confirm-keyed), so re-firing is safe.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inngest } from "../../client";

export const rampSweepFunction = inngest.createFunction(
  { id: "ramp-sweep", retries: 2 },
  { cron: "0 * * * *" }, // hourly
  async ({ step }) => {
    const client = getCarbonServiceRole();

    const companyIds = await step.run("find-ramp-sweep-targets", async () => {
      const { data, error } = await client
        .from("companyIntegration")
        .select("companyId")
        .eq("id", "ramp")
        .eq("active", true);

      if (error) {
        throw new Error(`Failed to list Ramp integrations: ${error.message}`);
      }

      return (data ?? []).map((row) => row.companyId);
    });

    if (companyIds.length === 0) {
      return { targets: 0 };
    }

    await step.sendEvent(
      "dispatch-ramp-sync",
      companyIds.map((companyId) => ({
        name: "carbon/ramp-sync" as const,
        data: { companyId, reason: "sweep" }
      }))
    );

    return { targets: companyIds.length };
  }
);
