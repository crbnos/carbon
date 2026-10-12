// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Transaction } from "kysely";
import { InvalidInputError } from "../errors";

/** A currency's settlement precision for this company: the group's
 *  `currency.decimalPlaces`, never a literal. Billed amounts (rental billing
 *  periods, lease payment rows) are rounded to it. */
export async function currencyDecimals(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  currencyCode: string
): Promise<number> {
  const currency = await trx
    .selectFrom("currency")
    .innerJoin("company", "company.companyGroupId", "currency.companyGroupId")
    .select("currency.decimalPlaces")
    .where("company.id", "=", companyId)
    .where("currency.code", "=", currencyCode)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces === null) {
    throw new InvalidInputError(
      `Currency ${currencyCode} is not set up for this company`
    );
  }
  return currency.decimalPlaces;
}
