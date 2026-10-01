// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * "A supplier / customer must have someone we can reach and somewhere we can
 * place them."
 *
 * Two company settings — `requireSupplierContactAndLocation` and
 * `requireCustomerContactAndLocation` — gate this, both off by default. The
 * requirement is on the PARTY, not the document: a spend platform builds ONE
 * vendor per supplier and needs these facts once per supplier, not once per
 * order.
 *
 * `checkPartyContactRequirement` (`party-contact.server.ts`) is the SINGLE
 * enforcement point, called at the six release / post boundaries (supplier
 * quote, purchase order, purchase invoice and their sales mirrors). There is
 * deliberately no field-level requirement on the documents themselves: a
 * document naming a contact id is not what the push needs, it broke editing an
 * existing document whose optional location happened to be null, and a zod
 * schema on six forms could never cover the create actions, the API or MCP —
 * which all reached the permissive validator anyway. The bar is asked once, of
 * the party record, at the moment it actually matters.
 *
 * The bar is exactly what a vendor create needs, verified field-by-field against
 * the Ramp sandbox on 2026-09-28 (`POST /developer/v1/vendors`):
 *
 *   - no `country`                  → 422 `{"country": ["Missing data for required field."]}`
 *   - no `business_vendor_contacts` → 422 `{"business_vendor_contacts": [...]}`
 *   - a contact carrying no email   → 422 `{"business_vendor_contacts": {"email": [...]}}`
 *   - country `US` with no state    → 400 `DEVELOPER_7080 "State is required for US"`
 *   - email + `US` + state `VA`     → 200
 *   - email + `GB`, no state        → 200
 *
 * So: a contact with an EMAIL (a phone-only contact satisfies nothing), and a
 * location whose address carries a COUNTRY — plus a STATE when that country is
 * US. Keeping the bar identical to what the push actually needs is the whole
 * point; a setting that passes and then fails downstream is worse than no
 * setting.
 */

export type PartyKind = "supplier" | "customer";

/** The setting column that governs each party kind. */
export const PARTY_CONTACT_SETTING = {
  supplier: "requireSupplierContactAndLocation",
  customer: "requireCustomerContactAndLocation"
} as const satisfies Record<PartyKind, string>;

/**
 * The one country that needs more than a country code.
 *
 * Ramp rejects a US vendor with no `state` and accepts a GB one without it, so
 * this is a real per-country rule rather than a general "addresses should be
 * complete" preference.
 */
export const STATE_REQUIRED_COUNTRIES = new Set(["US", "USA"]);

/**
 * Whether a contact can actually be reached.
 *
 * A blank-but-present string counts as absent — an empty `email` column is
 * common and would otherwise pass the gate and fail the push.
 */
export function isEmailableContact(contact: {
  email?: string | null;
}): boolean {
  return Boolean(contact.email?.trim());
}

export function hasEmailableContact(
  contacts: ReadonlyArray<{ email?: string | null }>
): boolean {
  return contacts.some(isEmailableContact);
}

/** An address a platform can actually place: a country, and a US state. */
export function isUsableLocationAddress(address: {
  country?: string | null;
  stateProvince?: string | null;
}): boolean {
  const country = address.country?.trim();
  if (!country) return false;
  if (!STATE_REQUIRED_COUNTRIES.has(country.toUpperCase())) return true;
  return Boolean(address.stateProvince?.trim());
}

export function hasUsableLocation(
  addresses: ReadonlyArray<{
    country?: string | null;
    stateProvince?: string | null;
  }>
): boolean {
  return addresses.some(isUsableLocationAddress);
}

/**
 * The two join-row shapes the party reads return — `supplierContact`/
 * `customerContact` embedding `contact(email)`, and `supplierLocation`/
 * `customerLocation` embedding `address(countryCode, stateProvince)`.
 */
export type PartyContactRow = { contact?: { email?: string | null } | null };
export type PartyLocationRow = {
  address?: {
    countryCode?: string | null;
    stateProvince?: string | null;
  } | null;
};

/**
 * Which of the two facts a party is missing, given both reads. The whole
 * decision, with no I/O in it — `checkPartyContactRequirement` only runs the
 * queries, logs, and phrases the answer.
 *
 * Two things live here because both have been wrong:
 *
 *  - The column is `address.countryCode`; the pure address rule above takes
 *    `country`. Miss the rename and every complete US address reads as "no
 *    country", blocking a record that is actually fine.
 *  - The fail-open is PER READ. A read that FAILED reports nothing missing —
 *    a locations query that errored must not be reported as "no location" —
 *    but it must not suppress the other half's real finding either. Skipping
 *    both halves on either error let one flaky query hide a genuinely
 *    unreachable supplier.
 */
export function missingPartyFacts(reads: {
  contacts: { rows: ReadonlyArray<PartyContactRow> | null; failed: boolean };
  locations: { rows: ReadonlyArray<PartyLocationRow> | null; failed: boolean };
}): { contact: boolean; location: boolean } {
  return {
    contact:
      !reads.contacts.failed &&
      !hasEmailableContact(
        (reads.contacts.rows ?? []).flatMap((row) =>
          row.contact ? [row.contact] : []
        )
      ),
    location:
      !reads.locations.failed &&
      !hasUsableLocation(
        (reads.locations.rows ?? []).flatMap((row) =>
          row.address
            ? [
                {
                  country: row.address.countryCode ?? null,
                  stateProvince: row.address.stateProvince ?? null
                }
              ]
            : []
        )
      )
  };
}

/**
 * What to tell someone who cannot post because the party record is incomplete.
 *
 * Names the party AND which of the two facts is missing — "a contact is
 * required" sends the reader looking, while naming the record and the field is
 * actionable. Both can be missing at once, which is the common case for a
 * supplier somebody created from just a name.
 */
export function partyContactRequiredMessage(
  kind: PartyKind,
  name: string | null | undefined,
  missing: { contact: boolean; location: boolean }
): string {
  const who =
    name?.trim() || (kind === "supplier" ? "This supplier" : "This customer");
  const where = kind === "supplier" ? "Suppliers" : "Customers";

  const parts: string[] = [];
  if (missing.contact) parts.push("a contact with an email address");
  if (missing.location)
    parts.push("a location with a country (and a state, for US addresses)");

  return `${who} needs ${parts.join(" and ")}. Add ${
    parts.length > 1 ? "them" : "it"
  } on the ${kind} record before posting. (${where} → ${
    missing.contact && !missing.location
      ? "Contacts"
      : missing.location && !missing.contact
        ? "Locations"
        : "Contacts and Locations"
  }. This is required by your company's settings.)`;
}
