// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Transaction } from "kysely";

type PartyDimension = { id: string; entityType: string };

/** The company group's active party dimensions, for `partyDimensionValuesFrom`. */
export function loadPartyDimensions(
  trx: Transaction<KyselyDatabase>,
  companyGroupId: string,
  entityTypes: ("CustomerType" | "Customer" | "SupplierType" | "Supplier")[] = [
    "CustomerType",
    "Customer",
    "SupplierType",
    "Supplier"
  ]
): Promise<PartyDimension[]> {
  return trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", entityTypes)
    .execute();
}

/** `partyDimensionValues` over dimensions already read. */
export function partyDimensionValuesFrom(
  dimensions: PartyDimension[],
  args: { isAR: boolean; partyId: string; typeId: string | null }
): { dimensionId: string; valueId: string }[] {
  const { isAR, partyId, typeId } = args;
  const partyType = isAR ? "Customer" : "Supplier";
  return dimensions
    .filter((dimension) =>
      isAR
        ? dimension.entityType === "CustomerType" ||
          dimension.entityType === "Customer"
        : dimension.entityType === "SupplierType" ||
          dimension.entityType === "Supplier"
    )
    .flatMap((dimension) => {
      const valueId = dimension.entityType === partyType ? partyId : typeId;
      return valueId ? [{ dimensionId: dimension.id, valueId }] : [];
    });
}

/**
 * The party dimensions of a payment or memo journal: Customer and
 * CustomerType for a customer, Supplier and SupplierType for a supplier.
 * Every line of the journal carries each of them.
 */
export async function partyDimensionValues(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyGroupId: string;
    isAR: boolean;
    partyId: string;
    typeId: string | null;
  }
): Promise<{ dimensionId: string; valueId: string }[]> {
  const { companyGroupId, isAR } = args;
  const dimensions = await loadPartyDimensions(
    trx,
    companyGroupId,
    isAR ? ["CustomerType", "Customer"] : ["SupplierType", "Supplier"]
  );
  return partyDimensionValuesFrom(dimensions, args);
}
