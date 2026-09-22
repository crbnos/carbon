import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";
import { companyHasFeature } from "./plan.server";

/**
 * The commercial gate for the workflows engine. The engine itself moved into
 * `@carbon/ee/workflows`, but the RUNTIME (`@carbon/jobs` `executeWorkflowRun`)
 * and the AUTHORING service (`apps/erp`) live in community code, so the lock has
 * to sit on the commercial side here.
 *
 * `workflowsEnabledForCompany` is the RUNTIME DEGRADE path — a queued run for a
 * non-entitled company settles `Skipped` rather than throwing. A run executes on
 * a background event, entirely bypassing the route-level `requireFeature` gate,
 * so without this a Community/Starter company's workflows would still fire.
 *
 * `requireWorkflowsEntitlement` is the AUTHORING throw — used by the server-only
 * publish/save path so creating or publishing a workflow requires executing
 * commercial code (the route `requireFeature` redirect is the strippable UX gate
 * this backstops).
 */
export async function workflowsEnabledForCompany(
  companyId: string
): Promise<boolean> {
  // Reads the plan via the service role internally (see `plan.server`), so the
  // Inngest runtime caller need not build/inject a client.
  return companyHasFeature(getCarbonServiceRole(), companyId, {
    feature: "WORKFLOWS"
  });
}

export async function requireWorkflowsEntitlement(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<void> {
  await requireEntitlement(client, companyId, "WORKFLOWS");
}
