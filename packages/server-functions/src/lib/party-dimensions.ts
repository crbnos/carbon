// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Transaction } from "kysely";

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
  const { companyGroupId, isAR, partyId, typeId } = args;
  const dimensions = await trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", companyGroupId)
    .where("active", "=", true)
    .where(
      "entityType",
      "in",
      isAR ? ["CustomerType", "Customer"] : ["SupplierType", "Supplier"]
    )
    .execute();
  return dimensions.flatMap((dimension) => {
    const valueId =
      dimension.entityType === (isAR ? "Customer" : "Supplier")
        ? partyId
        : typeId;
    return valueId ? [{ dimensionId: dimension.id, valueId }] : [];
  });
}
