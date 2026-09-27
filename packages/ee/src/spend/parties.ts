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
 * When no purchasing contact is set, the supplier's SOLE emailable contact is
 * used instead. A vendor create needs an email — Ramp rejects the whole request
 * with `business_vendor_contacts.email: "Missing data for required field"`,
 * verified live 2026-09-26 — so a supplier that plainly has one contact would
 * otherwise block every bill for want of a pointer field nobody knew to set.
 *
 * Exactly one, never a guess: with two or more emailable contacts there is no
 * unambiguous answer and the caller is told to set the purchasing contact. This
 * is the same rule the counterpart ladder uses — a single match links, ambiguity
 * refuses.
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
        "contact.email as email",
        "contact.firstName as firstName",
        "contact.lastName as lastName",
        "contact.mobilePhone as mobilePhone",
        "contact.homePhone as homePhone",
        "contact.workPhone as workPhone"
      ])
      .where("supplierContact.companyId", "=", companyId)
      .where("supplierContact.supplierId", "in", withoutContact)
      .execute();

    for (const [supplierId, contact] of pickSoleEmailableContacts(candidates)) {
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
    .execute();

  const addressBySupplier = new Map<string, (typeof locations)[number]>();
  for (const location of locations) {
    const current = addressBySupplier.get(location.supplierId);
    if (!current || (!current.countryCode && location.countryCode)) {
      addressBySupplier.set(location.supplierId, location);
    }
  }

  for (const supplier of suppliers) {
    const address = addressBySupplier.get(supplier.id) ?? null;
    const fallback = supplier.email
      ? undefined
      : soleContactBySupplier.get(supplier.id);
    const email = supplier.email ?? fallback?.email ?? null;
    const firstName = supplier.firstName ?? fallback?.firstName ?? null;
    const lastName = supplier.lastName ?? fallback?.lastName ?? null;
    const phone =
      supplier.mobilePhone ??
      supplier.workPhone ??
      supplier.homePhone ??
      fallback?.mobilePhone ??
      fallback?.workPhone ??
      fallback?.homePhone ??
      null;
    const hasContact = Boolean(email ?? firstName ?? lastName);

    map.set(supplier.id, {
      id: supplier.id,
      name: supplier.name,
      supplierTypeId: supplier.supplierTypeId ?? null,
      country: address?.countryCode ?? null,
      contact: hasContact ? { email, firstName, lastName, phone } : null,
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
 * The one contact per supplier that can stand in for an unset purchasing contact.
 *
 * "Emailable" because a vendor create without an email is rejected outright, so a
 * contact carrying none cannot substitute. EXACTLY one, never a guess: a supplier
 * with two emailable contacts has no unambiguous answer, and picking either would
 * put a stranger on the vendor record at the platform. The caller is told to set
 * the purchasing contact instead.
 *
 * Same rule as the counterpart ladder: a single match links, ambiguity refuses.
 */
export function pickSoleEmailableContacts<
  T extends { supplierId: string; email: string | null }
>(candidates: readonly T[]): Map<string, T> {
  const bySupplier = new Map<string, T[]>();
  for (const candidate of candidates) {
    if (!candidate.email?.trim()) continue;
    const list = bySupplier.get(candidate.supplierId);
    if (list) list.push(candidate);
    else bySupplier.set(candidate.supplierId, [candidate]);
  }

  const sole = new Map<string, T>();
  for (const [supplierId, list] of bySupplier) {
    const only = list.length === 1 ? list[0] : undefined;
    if (only) sole.set(supplierId, only);
  }
  return sole;
}

/**
 * Why a spend vendor could not be created, in terms the reader can act on.
 *
 * Ramp requires `name`, `country` and `business_vendor_contacts.email` — all
 * three verified live 2026-09-26 (a create without a contact, and one with a
 * contact carrying no email, are both rejected `DEVELOPER_7001 "Missing data for
 * required field"`). Which of them is absent is the only useful part, and the
 * previous message omitted it along with the supplier's name.
 */
export function describeMissingVendorFields(
  supplier: SpendVendorParty
): string {
  const missing: string[] = [];
  if (!supplier.name?.trim()) missing.push("a name");
  if (!supplier.contact?.email?.trim()) missing.push("a contact email");
  if (!supplier.country?.trim())
    missing.push("a country on one of its locations");

  const who = supplier.name?.trim() || `supplier ${supplier.id}`;
  if (missing.length === 0) {
    // Everything Carbon checks is present, so the platform refused for its own
    // reason — say so rather than implying the record is incomplete.
    return `${who} could not be created as a Ramp vendor; see the provider error on the previous attempt`;
  }

  return `${who} needs ${missing.join(" and ")} before it can be created as a Ramp vendor. If the supplier has several contacts, set its purchasing contact so Carbon knows which to use.`;
}
