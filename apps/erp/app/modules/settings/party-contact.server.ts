import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hasEmailableContact,
  hasUsableLocation,
  PARTY_CONTACT_SETTING,
  type PartyKind,
  partyContactRequiredMessage
} from "./party-contact";

/**
 * Enforce the "party must have a reachable contact AND an identifiable
 * location" setting at a document boundary.
 *
 * Returns an error MESSAGE, or null when the document may proceed. A route
 * turns that into its own flash/validation shape rather than this throwing,
 * because the six call sites (supplier quote, purchase order, purchase invoice
 * and their sales mirrors) each report failure differently.
 *
 * Fails OPEN on a read error. This gate exists to stop a document reaching a
 * platform that will reject it — a transient database hiccup is not a reason to
 * block someone from posting, and the push itself still refuses with a named
 * error if the record really is incomplete.
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

  const isSupplier = party.kind === "supplier";
  // `supplierContact` / `customerContact` are the join rows; the email lives on
  // `contact`. Same shape for locations: the join row carries the address.
  const contactTable = isSupplier ? "supplierContact" : "customerContact";
  const locationTable = isSupplier ? "supplierLocation" : "customerLocation";
  const partyColumn = isSupplier ? "supplierId" : "customerId";

  const [contacts, locations] = await Promise.all([
    client
      .from(contactTable)
      .select("contact(email)")
      .eq(partyColumn, party.id)
      .eq("companyId", companyId),
    client
      .from(locationTable)
      .select("address(countryCode, stateProvince)")
      .eq(partyColumn, party.id)
      .eq("companyId", companyId)
  ]);

  // Fail open per read, independently: a locations query that errored must not
  // be reported as "no location".
  if (contacts.error || locations.error) return null;

  const contactRows = (contacts.data ?? []).flatMap((row) => {
    const contact = (row as { contact?: { email?: string | null } | null })
      .contact;
    return contact ? [contact] : [];
  });

  const addressRows = (locations.data ?? []).flatMap((row) => {
    const address = (
      row as {
        address?: {
          countryCode?: string | null;
          stateProvince?: string | null;
        } | null;
      }
    ).address;
    return address
      ? [
          {
            country: address.countryCode ?? null,
            stateProvince: address.stateProvince ?? null
          }
        ]
      : [];
  });

  const missing = {
    contact: !hasEmailableContact(contactRows),
    location: !hasUsableLocation(addressRows)
  };

  if (!missing.contact && !missing.location) return null;

  const table = isSupplier ? "supplier" : "customer";
  const named = await client
    .from(table)
    .select("name")
    .eq("id", party.id)
    .eq("companyId", companyId)
    .maybeSingle();

  return partyContactRequiredMessage(
    party.kind,
    (named.data as { name?: string | null } | null)?.name ?? null,
    missing
  );
}
