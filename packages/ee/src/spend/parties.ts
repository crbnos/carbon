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
    const hasContact = Boolean(
      supplier.email ?? supplier.firstName ?? supplier.lastName
    );

    map.set(supplier.id, {
      id: supplier.id,
      name: supplier.name,
      supplierTypeId: supplier.supplierTypeId ?? null,
      country: address?.countryCode ?? null,
      contact: hasContact
        ? {
            email: supplier.email ?? null,
            firstName: supplier.firstName ?? null,
            lastName: supplier.lastName ?? null,
            phone:
              supplier.mobilePhone ??
              supplier.workPhone ??
              supplier.homePhone ??
              null
          }
        : null,
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
