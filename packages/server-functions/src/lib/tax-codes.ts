// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  effectiveComponents,
  type TaxCodeInput
} from "@carbon/database/tax-components";

/**
 * The tax codes `ids` name, each with only the components in force on
 * `date` (YYYY-MM-DD), in two queries. Shared by every posting path that
 * splits a line's tax into components. A code of another company, or one
 * that no longer exists, is simply absent from the map.
 */
export async function loadTaxCodes(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string,
  ids: ReadonlyArray<string | null | undefined>,
  date: string
): Promise<Map<string, TaxCodeInput>> {
  const taxCodeIds = [...new Set(ids.filter((id): id is string => !!id))];
  if (taxCodeIds.length === 0) return new Map();

  const [codes, components] = await Promise.all([
    db
      .selectFrom("taxCode")
      .select(["id", "calculationType", "taxesShipping"])
      .where("companyId", "=", companyId)
      .where("id", "in", taxCodeIds)
      .execute(),
    db
      .selectFrom("taxCodeComponent")
      .select([
        "id",
        "taxCodeId",
        "name",
        "taxAuthorityId",
        "taxPercent",
        "recoverablePercent",
        "sequence",
        "isCompound",
        "taxReceivedAccountId",
        "taxPaidAccountId",
        "effectiveDate",
        "expirationDate"
      ])
      .where("companyId", "=", companyId)
      .where("taxCodeId", "in", taxCodeIds)
      .execute()
  ]);

  return new Map(
    codes.map((code) => {
      const all = components
        .filter((c) => c.taxCodeId === code.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          taxAuthorityId: c.taxAuthorityId,
          taxPercent: Number(c.taxPercent),
          recoverablePercent: Number(c.recoverablePercent),
          sequence: c.sequence,
          isCompound: c.isCompound,
          taxReceivedAccountId: c.taxReceivedAccountId,
          taxPaidAccountId: c.taxPaidAccountId,
          effectiveDate: c.effectiveDate,
          expirationDate: c.expirationDate
        }));
      return [
        code.id,
        {
          id: code.id,
          calculationType: code.calculationType,
          taxesShipping: code.taxesShipping,
          components: effectiveComponents({ components: all }, date)
        }
      ];
    })
  );
}
