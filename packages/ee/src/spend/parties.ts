// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Carbon supplier identity a spend platform needs to match or create its own
 * vendor record.
 *
 * Entirely Carbon-side: this is a statement about Carbon's supplier / contact /
 * address schema, not about any platform's API. Every spend provider needs the
 * same rows, so the load lives here and each adapter maps it to its own wire
 * shape — the same split the accounting providers use (`document-costing.ts`,
 * `sales-invoice-source.ts`, `card-charge-source.ts`).
 */

import type { Kysely, KyselyDatabase } from "@carbon/database/client";

export type SpendVendorParty = {
  id: string;
  name: string | null;
  country: string | null;
  contact: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  } | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    stateProvince: string | null;
    postalCode: string | null;
  } | null;
};

/** A bare party when its details row is missing — a vendor may be optional. */
export function emptySpendVendorParty(
  id: string,
  name: string | null
): SpendVendorParty {
  return { id, name, country: null, contact: null, address: null };
}

/**
 * Batched supplier identity for a page of documents.
 *
 * The purchasing contact comes through `supplier.purchasingContactId`, and the
 * country through whichever of the supplier's locations carries one — platforms
 * require a country on a vendor create, and a location without one is useless
 * for that, so a location that HAS a country is preferred over the first.
 *
 * When the purchasing contact has no email, the supplier's first emailable
 * contact is used instead — WHOLE, never field-by-field (see
 * {@link resolveVendorContact}). A vendor create needs an email — Ramp rejects
 * the whole request with `business_vendor_contacts.email: "Missing data for
 * required field"`, verified live 2026-09-26 — so a supplier that plainly has
 * one contact would otherwise block every bill for want of a pointer field
 * nobody knew to set.
 */
export async function loadSpendVendorParties(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  supplierIds: string[]
): Promise<Map<string, SpendVendorParty & { supplierTypeId: string | null }>> {
  const map = new Map<
    string,
    SpendVendorParty & { supplierTypeId: string | null }
  >();
  const ids = [...new Set(supplierIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const suppliers = await db
    .selectFrom("supplier")
    .leftJoin(
      "supplierContact",
      "supplierContact.id",
      "supplier.purchasingContactId"
    )
    .leftJoin("contact", "contact.id", "supplierContact.contactId")
    .select([
      "supplier.id as id",
      "supplier.name as name",
      "supplier.supplierTypeId as supplierTypeId",
      "contact.email as email",
      "contact.firstName as firstName",
      "contact.lastName as lastName",
      "contact.mobilePhone as mobilePhone",
      "contact.homePhone as homePhone",
      "contact.workPhone as workPhone"
    ])
    .where("supplier.companyId", "=", companyId)
    .where("supplier.id", "in", ids)
    .execute();

  // Fall back to a sole emailable contact for suppliers with no purchasing
  // contact. Scoped to those suppliers so the common path costs nothing.
  const withoutContact = suppliers
    .filter((supplier) => !supplier.email)
    .map((supplier) => supplier.id);

  const soleContactBySupplier = new Map<
    string,
    {
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      mobilePhone: string | null;
      homePhone: string | null;
      workPhone: string | null;
    }
  >();

  if (withoutContact.length > 0) {
    const candidates = await db
      .selectFrom("supplierContact")
      .innerJoin("contact", "contact.id", "supplierContact.contactId")
      .select([
        "supplierContact.supplierId as supplierId",
        "supplierContact.id as supplierContactId",
        "contact.email as email",
        "contact.firstName as firstName",
        "contact.lastName as lastName",
        "contact.mobilePhone as mobilePhone",
        "contact.homePhone as homePhone",
        "contact.workPhone as workPhone"
      ])
      .where("supplierContact.companyId", "=", companyId)
      .where("supplierContact.supplierId", "in", withoutContact)
      // "First" has to MEAN something. Without an explicit order Postgres may
      // return the rows differently between runs, and the vendor's contact at
      // the platform would flip from one person to another on an ordinary
      // re-push. Ordering by the join row's id is stable and approximates the
      // order they were added.
      .orderBy("supplierContact.id")
      .execute();

    for (const [supplierId, contact] of pickVendorContacts(candidates)) {
      soleContactBySupplier.set(supplierId, contact);
    }
  }

  const locations = await db
    .selectFrom("supplierLocation")
    .innerJoin("address", "address.id", "supplierLocation.addressId")
    .select([
      "supplierLocation.supplierId as supplierId",
      "address.countryCode as countryCode",
      "address.addressLine1 as addressLine1",
      "address.addressLine2 as addressLine2",
      "address.city as city",
      "address.stateProvince as stateProvince",
      "address.postalCode as postalCode"
    ])
    .where("supplierLocation.companyId", "=", companyId)
    .where("supplierLocation.supplierId", "in", ids)
    // Same reason as the contact read above: without an explicit order Postgres
    // may hand back a supplier's locations differently between runs, so which
    // one became the vendor's country/state flipped on an ordinary re-push (and
    // so did the "needs a two-letter state" message it produced).
    .orderBy("supplierLocation.id")
    .execute();

  const addressBySupplier = pickVendorAddresses(locations);

  for (const supplier of suppliers) {
    const address = addressBySupplier.get(supplier.id) ?? null;

    map.set(supplier.id, {
      id: supplier.id,
      name: supplier.name,
      supplierTypeId: supplier.supplierTypeId ?? null,
      country: address?.countryCode ?? null,
      contact: resolveVendorContact(
        supplier,
        soleContactBySupplier.get(supplier.id)
      ),
      address: address
        ? {
            line1: address.addressLine1 ?? null,
            line2: address.addressLine2 ?? null,
            city: address.city ?? null,
            stateProvince: address.stateProvince ?? null,
            postalCode: address.postalCode ?? null
          }
        : null
    });
  }

  return map;
}

/**
 * The contact to put on the platform's vendor record when the supplier has no
 * purchasing contact set.
 *
 * "Emailable" because a vendor create without an email is rejected outright
 * (`DEVELOPER_7001 "Missing data for required field"`, verified live 2026-09-26),
 * so a phone-only contact cannot substitute.
 *
 * With several to choose from this takes the FIRST rather than refusing. An
 * earlier version demanded exactly one and told the caller to set the purchasing
 * contact — correct in the abstract, but it blocked the push over a choice
 * nobody had made and that a human would make arbitrarily anyway. A vendor
 * record carrying the wrong colleague is a smaller problem than a bill that
 * never arrives, and setting the purchasing contact still overrides it.
 *
 * Callers must supply the candidates in a STABLE order (the query orders by the
 * join row's id) — otherwise "first" changes between runs and the vendor's
 * contact flips on an ordinary re-push.
 */
export function pickVendorContacts<
  T extends { supplierId: string; email: string | null }
>(candidates: readonly T[]): Map<string, T> {
  const chosen = new Map<string, T>();
  for (const candidate of candidates) {
    if (!candidate.email?.trim()) continue;
    if (chosen.has(candidate.supplierId)) continue;
    chosen.set(candidate.supplierId, candidate);
  }
  return chosen;
}

/** The contact columns this module reads, whichever row they came from. */
export type SpendContactRow = {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  mobilePhone: string | null;
  homePhone: string | null;
  workPhone: string | null;
};

/**
 * The ONE contact that goes on the platform's vendor record.
 *
 * The purchasing contact wins whenever it is emailable; otherwise the fallback
 * replaces it ENTIRELY. That "entirely" is the whole point: the fallback used to
 * be applied per field (`supplier.firstName ?? fallback.firstName`, and so on
 * independently), so a purchasing contact with a name but no email produced a
 * vendor carrying one person's name and another person's email address. Nobody
 * reading the record in Ramp could tell, and a spend vendor is create-once — the
 * mixed identity is permanent.
 *
 * With no fallback the purchasing contact is kept as it is: a name with no email
 * cannot create a vendor, but it can still MATCH one, and it is what
 * `describeMissingVendorFields` needs to say which field is absent.
 */
export function resolveVendorContact(
  primary: SpendContactRow | null | undefined,
  fallback: SpendContactRow | null | undefined
): SpendVendorParty["contact"] {
  const chosen = primary?.email?.trim() ? primary : (fallback ?? primary);
  if (!chosen) return null;

  const email = chosen.email ?? null;
  const firstName = chosen.firstName ?? null;
  const lastName = chosen.lastName ?? null;
  if (!(email || firstName || lastName)) return null;

  return {
    email,
    firstName,
    lastName,
    phone: chosen.mobilePhone ?? chosen.workPhone ?? chosen.homePhone ?? null
  };
}

/**
 * The one location per supplier whose address goes on the vendor record.
 *
 * Preference, best first: an address that SATISFIES the vendor-create rule (a
 * country, plus a state when the country is in
 * {@link STATE_REQUIRED_VENDOR_COUNTRIES}), then any address with a country,
 * then whatever came first.
 *
 * Both halves matter. The old picker only upgraded an incumbent that had no
 * country at all, so a supplier with two US locations — one carrying a state,
 * one not — kept whichever Postgres happened to return, and
 * `describeMissingVendorFields` reported "needs a two-letter state on its US
 * location" while a complete location sat right next to it. And because the read
 * had no `ORDER BY`, the answer could differ between two runs over identical
 * data. Callers must supply the rows in a stable order (the query orders by the
 * `supplierLocation` id) — without it "first" means nothing here either.
 */
export function pickVendorAddresses<
  T extends {
    supplierId: string;
    countryCode: string | null;
    stateProvince: string | null;
  }
>(locations: readonly T[]): Map<string, T> {
  const chosen = new Map<string, T>();
  const scores = new Map<string, number>();
  for (const location of locations) {
    const score = vendorAddressScore(location);
    const incumbent = scores.get(location.supplierId);
    if (incumbent !== undefined && incumbent >= score) continue;
    chosen.set(location.supplierId, location);
    scores.set(location.supplierId, score);
  }
  return chosen;
}

/** 2 = creatable, 1 = has a country, 0 = useless for a vendor create. */
function vendorAddressScore(location: {
  countryCode: string | null;
  stateProvince: string | null;
}): number {
  const country = location.countryCode?.trim();
  if (!country) return 0;
  if (!STATE_REQUIRED_VENDOR_COUNTRIES.has(country.toUpperCase())) return 2;
  return location.stateProvince?.trim() ? 2 : 1;
}

/**
 * Countries whose vendor create needs more than a country code.
 *
 * `US` with no `state` is refused `400 DEVELOPER_7080`, while `GB` with no state
 * is accepted — so this is a real per-country rule, not address hygiene.
 */
export const STATE_REQUIRED_VENDOR_COUNTRIES = new Set(["US", "USA"]);

/**
 * Why a spend vendor could not be created, in terms the reader can act on.
 *
 * Ramp requires `name`, `country`, `business_vendor_contacts.email`, AND — for a
 * US country — a two-letter `state`. All four verified field-by-field against
 * the sandbox on 2026-09-28:
 *
 *   - no `country`                  → `422 {"country": ["Missing data for required field."]}`
 *   - no `business_vendor_contacts` → `422 {"business_vendor_contacts": [...]}`
 *   - a contact with no email       → `422 {"business_vendor_contacts": {"email": [...]}}`
 *   - `US` with no `state`          → `400 DEVELOPER_7080 "State is required for US"`
 *   - email + `US` + state `VA`     → 200
 *   - email + `GB`, no state        → 200
 *
 * Which of them is absent is the only useful part of the message. The US state
 * was missing from this list until 2026-09-28, so a US supplier with a country
 * but no state fell through to the "see the provider error" branch — technically
 * true, and useless to the person who has to fix the record.
 */
export function describeMissingVendorFields(
  supplier: SpendVendorParty
): string {
  const missing: string[] = [];
  if (!supplier.name?.trim()) missing.push("a name");
  if (!supplier.contact?.email?.trim()) missing.push("a contact email");
  const country = supplier.country?.trim();
  if (!country) {
    missing.push("a country on one of its locations");
  } else if (
    STATE_REQUIRED_VENDOR_COUNTRIES.has(country.toUpperCase()) &&
    !supplier.address?.stateProvince?.trim()
  ) {
    // Ramp names the remedy precisely, so pass it through rather than paraphrasing.
    missing.push("a two-letter state on its US location");
  }

  const who = supplier.name?.trim() || `supplier ${supplier.id}`;
  if (missing.length === 0) {
    // Everything Carbon checks is present, so the platform refused for its own
    // reason — say so rather than implying the record is incomplete.
    return `${who} could not be created as a Ramp vendor; see the provider error on the previous attempt`;
  }

  return `${who} needs ${missing.join(" and ")} before it can be created as a Ramp vendor.`;
}
