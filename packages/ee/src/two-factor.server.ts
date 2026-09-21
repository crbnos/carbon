import type { Database } from "@carbon/database";
import { sanitize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial (Business) company-wide two-factor policy. Setting
 * `companySettings.requireMfa = true` forces every member to enrol an
 * authenticator before they can open the company — gated to the Business plan
 * via the `TWO_FACTOR` feature.
 *
 * Only ENABLING is gated: a downgraded company can still turn the policy OFF so
 * it is never locked out of its own account. MFA enrolment itself (Supabase
 * GoTrue) is unaffected; this governs only the company-wide REQUIREMENT.
 */
export async function updateRequireMfaSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  requireMfa: boolean
) {
  if (requireMfa) {
    await requireEntitlement(client, companyId, "TWO_FACTOR");
  }
  return client
    .from("companySettings")
    .update(sanitize({ requireMfa }))
    .eq("id", companyId);
}
