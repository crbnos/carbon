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

import type { PartyContactKind, ResolvedCapabilities } from "./capabilities";

/** The setting column that governs each party kind. */
export const PARTY_CONTACT_SETTING_COLUMN = {
  supplier: "requireSupplierContactAndLocation",
  customer: "requireCustomerContactAndLocation"
} as const satisfies Record<PartyContactKind, string>;

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
 * Best-effort by contract: the caller is an install hook, and failing an
 * otherwise-good connection over a settings write would be the worse outcome.
 * Returns which columns it enabled so the caller can log it.
 */
export async function applyPartyContactRequirements(
  client: {
    from: (table: string) => any;
  },
  companyId: string,
  capabilities: Pick<ResolvedCapabilities, "requiresPartyContactAndLocation">
): Promise<PartyContactSettingColumn[]> {
  const columns = partyContactSettingsToEnable(capabilities);
  if (columns.length === 0) return [];

  // Read first so the return value is what CHANGED, not what was asked for —
  // an install that re-converges every settings save would otherwise report
  // enabling something a human turned on months ago.
  const { data } = await client
    .from("companySettings")
    .select(columns.join(", "))
    .eq("id", companyId)
    .single();

  const missing = columns.filter((column) => data?.[column] !== true);
  if (missing.length === 0) return [];

  const { error } = await client
    .from("companySettings")
    .update(Object.fromEntries(missing.map((column) => [column, true])))
    .eq("id", companyId);

  if (error) throw new Error(error.message ?? String(error));

  return missing;
}
