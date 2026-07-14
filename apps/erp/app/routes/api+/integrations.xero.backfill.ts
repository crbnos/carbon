import { requirePermissions } from "@carbon/auth/auth.server";
import { ProviderID } from "@carbon/ee/accounting";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "integrations-xero-backfill");

const BackfillSettingsSchema = z.object({
  backfillCustomers: z.boolean().optional().default(true),
  backfillVendors: z.boolean().optional().default(true),
  backfillItems: z.boolean().optional().default(true)
  // Note: The backfill task now respects each entity's sync direction config
  // (pull-from-accounting, push-to-accounting, or two-way) rather than using
  // a global pullOnly flag. This is configured per-entity in syncConfig.
});

export const config = {
  runtime: "nodejs"
};

// GET: Check backfill status
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    update: "settings"
  });

  // TODO: run status polling was trigger.dev specific (runs.retrieve) and has been removed.
  // Reimplement with inngest if needed.
  return data({ status: "idle" });
}

// POST: Start backfill
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  // Verify Xero integration exists and is active
  const integration = await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", "xero")
    .single();

  if (integration.error || !integration.data?.active) {
    return data(
      { error: "Xero integration not found or inactive" },
      { status: 400 }
    );
  }

  // Parse settings from integration metadata
  const settings = BackfillSettingsSchema.parse(
    integration.data.metadata || {}
  );

  try {
    // Trigger the backfill task with settings
    // The backfill task respects each entity's sync direction config from
    // the integration metadata (pull-from-accounting, push-to-accounting, two-way)
    await trigger("accounting-backfill", {
      companyId,
      provider: ProviderID.XERO,
      batchSize: 50,
      entityTypes: {
        customers: settings.backfillCustomers,
        vendors: settings.backfillVendors,
        items: settings.backfillItems
      }
    });

    return data({
      success: true,
      message: "Contact import started"
    });
  } catch (error) {
    logger.error("Failed to start backfill", { error: error });
    return data({ error: "Failed to start contact import" }, { status: 500 });
  }
}
