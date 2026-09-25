import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { ProviderID } from "@carbon/ee/accounting";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "integrations-master-sync");

export const config = {
  runtime: "nodejs"
};

/**
 * POST — start a one-shot master-data sync for an accounting provider.
 *
 * Provider-agnostic, replacing the per-provider `integrations.xero.backfill`
 * and `integrations.rillet.import-contacts` routes. Everything comes from the
 * query string because `IntegrationActionButton` posts the descriptor's
 * `endpoint` with no body.
 *
 * Fire-and-forget: the `accounting-master-sync` job does the work and its
 * per-record outcome is the ledger, visible in Sync Activity.
 */
const QuerySchema = z.object({
  provider: z.nativeEnum(ProviderID),
  direction: z.enum(["push-to-accounting", "pull-from-accounting"]),
  /**
   * Comma-separated subset of `customers,vendors,items`. Absent = fall back to
   * the integration's own "Entities to Sync" settings (Xero has switches for
   * these; the others default to all three).
   */
  entities: z.string().optional()
});

/**
 * Xero exposes these as switches; providers without them fall through to the
 * defaults, which is the same all-three behaviour they had before.
 */
const EntitySettingsSchema = z.object({
  backfillCustomers: z.boolean().optional().default(true),
  backfillVendors: z.boolean().optional().default(true),
  backfillItems: z.boolean().optional().default(true)
});

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const query = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );

  if (!query.success) {
    return data({ error: "Unknown provider or direction" }, { status: 400 });
  }

  const { provider, direction, entities } = query.data;

  const integration = await client
    .from("companyIntegration")
    .select("active, metadata")
    .eq("companyId", companyId)
    .eq("id", provider)
    .single();

  if (integration.error || !integration.data?.active) {
    return data(
      { error: `${provider} integration not found or inactive` },
      { status: 400 }
    );
  }

  const settings = EntitySettingsSchema.parse(integration.data.metadata ?? {});

  // An explicit `entities` list wins: the import action names customers and
  // vendors, and asking the job for items it cannot enumerate would report a
  // failure the button never promised.
  const selected = entities?.split(",").map((value) => value.trim());
  const entityTypes = selected
    ? {
        customers: selected.includes("customers"),
        vendors: selected.includes("vendors"),
        items: selected.includes("items")
      }
    : {
        customers: settings.backfillCustomers,
        vendors: settings.backfillVendors,
        items: settings.backfillItems
      };

  try {
    await trigger("accounting-master-sync", {
      companyId,
      provider,
      direction,
      batchSize: 50,
      entityTypes
    });

    return data({ success: true, message: "Master data sync started" });
  } catch (error) {
    logger.error("Failed to start master data sync", {
      error,
      provider,
      direction
    });
    return data({ error: "Failed to start master data sync" }, { status: 500 });
  }
}
