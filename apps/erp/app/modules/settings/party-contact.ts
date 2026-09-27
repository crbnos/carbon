import { z } from "zod";
import { zfd } from "zod-form-data";

/**
 * "A supplier / customer must have someone we can reach."
 *
 * Two company settings — `requireSupplierContact` and `requireCustomerContact`
 * — gate this, both off by default. The requirement is on the PARTY, not the
 * document: a spend platform builds ONE vendor per supplier and needs a contact
 * email to do it, so the fact is needed once per supplier, not once per order.
 * Enforcement happens at the document boundary because that is where the user
 * has the context to answer it, but what gets checked (and fixed) is the
 * supplier record.
 *
 * The bar is an EMAIL, not merely a contact row. Ramp rejects a vendor create
 * whose contact carries no email exactly as it rejects one with no contact at
 * all (`DEVELOPER_7001 "Missing data for required field"`, verified live
 * 2026-09-26), so a contact with only a phone number satisfies nothing. Keeping
 * the bar identical to what the push actually needs is the whole point — a
 * setting that passes and then fails downstream is worse than no setting.
 */

export type PartyKind = "supplier" | "customer";

/** The setting column that governs each party kind. */
export const PARTY_CONTACT_SETTING = {
  supplier: "requireSupplierContact",
  customer: "requireCustomerContact"
} as const satisfies Record<PartyKind, string>;

/**
 * Whether a contact can actually be reached.
 *
 * Deliberately the same test the spend push applies before building a vendor
 * (`pickSoleEmailableContacts`). A blank-but-present string counts as absent —
 * an empty `email` column is common and would otherwise pass the gate and fail
 * the push.
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

/**
 * What to tell someone who cannot post because the party has no contact.
 *
 * Names the party and the exact remedy. The equivalent Ramp-side message had to
 * be rewritten for the same reason: "a contact is required" sends the reader
 * looking, while naming the record and the field is actionable.
 */
export function partyContactRequiredMessage(
  kind: PartyKind,
  name: string | null | undefined
): string {
  const who =
    name?.trim() || (kind === "supplier" ? "This supplier" : "This customer");
  const where = kind === "supplier" ? "Suppliers" : "Customers";

  return `${who} has no contact with an email address. Add one on the ${kind} record before posting. (${where} → Contacts. This is required by your company's settings.)`;
}

/**
 * The schema for a document's contact field when the company requires one.
 *
 * Lives here so all six documents phrase the requirement identically, and so the
 * rule sits next to the setting that governs it rather than being retyped in
 * three modules.
 *
 * Callers apply it with `.extend()` on a base object rather than a ternary inside
 * `z.object` — a ternary widens the INFERRED type, which makes the field look
 * required to every existing caller even when the setting is off.
 */
export function requiredContactField(label: string) {
  // `.trim()` before `.min(1)`: `zfd.text` turns an empty string into undefined but
  // leaves a whitespace-only one alone, which would otherwise satisfy the
  // requirement with a value that identifies nobody.
  return zfd.text(
    z
      .string({ error: `${label} is required` })
      .trim()
      .min(1, { message: `${label} is required` })
  );
}
