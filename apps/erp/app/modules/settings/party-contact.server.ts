import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hasEmailableContact,
  PARTY_CONTACT_SETTING,
  type PartyKind,
  partyContactRequiredMessage
} from "./party-contact";

/**
 * Enforce the "party must have a reachable contact" setting at a document
 * boundary.
 *
 * Returns an error MESSAGE, or null when the document may proceed. A route
 * turns that into its own flash/validation shape rather than this throwing,
 * because the six call sites (supplier quote, purchase order, purchase invoice
 * and their sales mirrors) each report failure differently.
 *
 * Fails OPEN on a read error. This gate exists to stop a document reaching a
 * platform that will reject it — a transient database hiccup is not a reason to
 * block someone from posting, and the push itself still refuses with a named
 * error if the contact really is missing.
 */
export async function checkPartyContactRequirement(
  client: SupabaseClient<Database>,
  companyId: string,
  party: { kind: PartyKind; id: string | null | undefined }
): Promise<string | null> {
  if (!party.id) return null;

  const settingColumn = PARTY_CONTACT_SETTING[party.kind];
  const settings = await client
    .from("companySettings")
    .select(settingColumn)
    .eq("id", companyId)
    .maybeSingle();

  if (settings.error || !settings.data) return null;
  const required = (settings.data as Record<string, unknown>)[settingColumn];
  if (required !== true) return null;

  // `supplierContact` / `customerContact` are the join rows; the email lives on
  // `contact`.
  const joinTable =
    party.kind === "supplier" ? "supplierContact" : "customerContact";
  const partyColumn = party.kind === "supplier" ? "supplierId" : "customerId";

  const contacts = await client
    .from(joinTable)
    .select("contact(email)")
    .eq(partyColumn, party.id)
    .eq("companyId", companyId);

  if (contacts.error) return null;

  const rows = (contacts.data ?? []).flatMap((row) => {
    const contact = (row as { contact?: { email?: string | null } | null })
      .contact;
    return contact ? [contact] : [];
  });

  if (hasEmailableContact(rows)) return null;

  const table = party.kind === "supplier" ? "supplier" : "customer";
  const named = await client
    .from(table)
    .select("name")
    .eq("id", party.id)
    .eq("companyId", companyId)
    .maybeSingle();

  return partyContactRequiredMessage(
    party.kind,
    (named.data as { name?: string | null } | null)?.name ?? null
  );
}
