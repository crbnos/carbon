/**
 * Turning a provider's "I cannot create a counterpart without a reachable
 * contact and an identifiable location" capability into the company setting
 * that enforces it.
 *
 * The push-time error is real but arrives far too late — by the time a bill
 * fails with "McMaster-Carr needs a contact email and a country on one of its
 * locations", the person who raised the purchase order has long moved on, and
 * the only signal is a failed sync. The company settings
 * `requireSupplierContactAndLocation` / `requireCustomerContactAndLocation`
 * move the same requirement to the document boundary, where whoever is
 * entering the document can still answer it.
 *
 * Connecting a platform that structurally requires the contact is what makes
 * the requirement true, so connecting it is what turns the setting on.
 */

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartyContactKind, ResolvedCapabilities } from "./capabilities";

type CompanySettingsUpdate =
  Database["public"]["Tables"]["companySettings"]["Update"];

/**
 * The setting column that governs each party kind.
 *
 * Constrained to real `companySettings` columns, so a typo is a compile error
 * rather than an UPDATE that matches nothing at runtime.
 */
export const PARTY_CONTACT_SETTING_COLUMN = {
  supplier: "requireSupplierContactAndLocation",
  customer: "requireCustomerContactAndLocation"
} as const satisfies Record<PartyContactKind, keyof CompanySettingsUpdate>;

export type PartyContactSettingColumn =
  (typeof PARTY_CONTACT_SETTING_COLUMN)[PartyContactKind];

/**
 * Which setting columns a provider's capabilities imply.
 *
 * Pure, so the mapping is testable without a database — the write below is
 * three lines of Supabase around this decision.
 */
export function partyContactSettingsToEnable(
  capabilities: Pick<ResolvedCapabilities, "requiresPartyContactAndLocation">
): PartyContactSettingColumn[] {
  return capabilities.requiresPartyContactAndLocation.map(
    (kind) => PARTY_CONTACT_SETTING_COLUMN[kind]
  );
}

/**
 * Turn on every party-contact requirement this provider implies. ON only —
 * never off.
 *
 * Asymmetric on purpose. Turning it on has a clear trigger (a platform that
 * cannot work without it just got connected) and a clear benefit. Turning it
 * off on uninstall does not follow: by then the company has been entering
 * contacts for months, other integrations or policies may depend on it, and
 * silently relaxing a data-quality rule as a side effect of removing something
 * else is the kind of change nobody attributes correctly. Uninstalling leaves
 * it on, and it stays a setting a human can turn off.
 *
 * Returns the columns it ACTUALLY enabled, so the caller can log them, and
 * THROWS when it cannot tell — a failed read, a missing settings row, or an
 * update that matched nothing. Best-effort lives in the CALLER: the install
 * hook wraps this in a try/catch so a settings write cannot fail an
 * otherwise-good connection. Swallowing here instead would report a write that
 * never happened, and that log is the only observable signal this gate has.
 */
export async function applyPartyContactRequirements(
  client: SupabaseClient<Database>,
  companyId: string,
  capabilities: Pick<ResolvedCapabilities, "requiresPartyContactAndLocation">
): Promise<PartyContactSettingColumn[]> {
  const columns = partyContactSettingsToEnable(capabilities);
  if (columns.length === 0) return [];

  // Read first so the return value is what CHANGED, not what was asked for —
  // an install that re-converges every settings save would otherwise report
  // enabling something a human turned on months ago.
  //
  // The error is NOT discarded, and that is the point. A failed (or absent)
  // read left `settings` undefined, every column then read as "missing", the
  // UPDATE matched zero rows and returned no error — so this function reported
  // enabling both columns and the install hook logged it, while nothing had
  // been written. That log is the only observable signal this gate has. The
  // caller is an install hook that already treats the whole call as
  // best-effort inside a try/catch, so throwing is the honest answer.
  const { data: settings, error: readError } = await client
    .from("companySettings")
    .select(columns.join(", "))
    .eq("id", companyId)
    .maybeSingle<Record<PartyContactSettingColumn, boolean | null>>();

  if (readError) {
    throw new Error(
      `Could not read companySettings for ${companyId}: ${readError.message}`
    );
  }
  if (!settings) {
    throw new Error(`No companySettings row for ${companyId}`);
  }

  const missing = columns.filter((column) => settings[column] !== true);
  if (missing.length === 0) return [];

  const patch: CompanySettingsUpdate = {};
  for (const column of missing) patch[column] = true;

  // `.select("id")` so the return value reflects rows actually UPDATED. Without
  // it an UPDATE matching nothing (wrong id, RLS) succeeds silently and this
  // function still claims the columns were enabled.
  const { data: updated, error } = await client
    .from("companySettings")
    .update(patch)
    .eq("id", companyId)
    .select("id");

  if (error) throw new Error(error.message ?? String(error));
  if (!updated || updated.length === 0) {
    throw new Error(
      `companySettings update for ${companyId} matched no rows; party-contact requirements were not enabled`
    );
  }

  return missing;
}
