// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { MountCompanyInput, MountObjectInput } from "./types";

/**
 * Carbon is the master for every field below. Mount holds no field that Carbon
 * does not, so the mapping is one-way by construction — nothing here reads a
 * Mount value back.
 *
 * Every record publishes, active or not. A non-conformance raised today can be
 * about a part discontinued last year, and the handler still has to select it;
 * withholding inactive records would leave a part that exists in Carbon,
 * was never published, and cannot be picked in Mount. Nothing is ever removed
 * from Mount either, so filtering on the way in is the
 * only thing that could create that gap.
 *
 * PENDING DECISION — status. Mount exposes `statusId` on both write payloads,
 * pointing at a `CompanyStatus`/`ObjectStatus` record whose `systemStatus` is
 * one of draft/published/archived (CompanyStatus also carries an `unavailable`
 * flag). Mapping Carbon's inactive records onto an archived Mount status would
 * let Mount grey them out or drop them from pickers instead of listing them
 * alongside live parts. Deliberately unset for now: it needs a per-tenant
 * status id in settings, and Carbon's three shapes (customer status rows,
 * the supplier status enum, item.active) do not map one-to-one onto it.
 * Additive whenever we decide — a PATCH can set `statusId` on records already
 * published, so nothing has to be re-pushed.
 */

export type CarbonCompanyRecord = {
  readableId: string | null;
  name: string;
  taxId?: string | null;
  vatNumber?: string | null;
  website?: string | null;
};

export type CarbonItemRecord = {
  readableId: string | null;
  name: string;
};

export class MissingIdentifierError extends Error {
  constructor(entity: string) {
    super(
      `${entity} has no readableId; Mount needs a stable identifier to match on`
    );
    this.name = "MissingIdentifierError";
  }
}

export function mapCustomerToMountCompany(
  customer: CarbonCompanyRecord,
  typeId?: string | null
): MountCompanyInput {
  if (!customer.readableId) throw new MissingIdentifierError("Customer");

  return {
    identifier: customer.readableId,
    name: customer.name,
    // Carbon keeps one `taxId` per party; for EU entities that is the
    // registration number, with VAT recorded separately.
    organizationNumber: customer.taxId ?? null,
    vatNumber: customer.vatNumber ?? null,
    website: customer.website ?? null,
    typeId: typeId ?? null
  };
}

export function mapSupplierToMountCompany(
  supplier: CarbonCompanyRecord,
  typeId?: string | null
): MountCompanyInput {
  if (!supplier.readableId) throw new MissingIdentifierError("Supplier");

  return {
    identifier: supplier.readableId,
    name: supplier.name,
    organizationNumber: supplier.taxId ?? null,
    vatNumber: supplier.vatNumber ?? null,
    website: supplier.website ?? null,
    typeId: typeId ?? null
  };
}

export function mapItemToMountObject(
  item: CarbonItemRecord,
  definitionId: string
): MountObjectInput {
  if (!item.readableId) throw new MissingIdentifierError("Item");

  return {
    identifier: item.readableId,
    title: item.name,
    definitionId
  };
}
