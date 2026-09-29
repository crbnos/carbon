import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { ProviderID } from "@carbon/ee/accounting";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

const logger = getLogger("erp", "integrations-journal-backfill");

export const config = {
  runtime: "nodejs"
};

const QuerySchema = z.object({
  provider: z.nativeEnum(ProviderID)
});

/**
 * POST — repair journal posting dispositions back to `postingSync.syncFromDate`.
 *
 * The outbound sweep does the same repair continuously, but only inside its
 * 7-day window; this covers the history behind it. It used to run as a hidden
 * phase of the Xero contact backfill, so it was unreachable on the other two
 * providers and invisible on Xero.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const query = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );

  if (!query.success) {
    return data({ error: "Unknown provider" }, { status: 400 });
  }

  const { provider } = query.data;

  const integration = await client
    .from("companyIntegration")
    .select("active")
    .eq("companyId", companyId)
    .eq("id", provider)
    .single();

  if (integration.error || !integration.data?.active) {
    return data(
      { error: `${provider} integration not found or inactive` },
      { status: 400 }
    );
  }

  try {
    await trigger("accounting-journal-backfill", { companyId, provider });
    return data({ success: true, message: "Journal backfill started" });
  } catch (error) {
    logger.error("Failed to start journal backfill", { error, provider });
    return data({ error: "Failed to start journal backfill" }, { status: 500 });
  }
}
