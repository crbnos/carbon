// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase as DB, Kysely } from "@carbon/database/client";
import {
  type AccountType,
  accountTypeFromClass,
  isAccountClass
} from "@carbon/database/ledger";
import { InvalidInputError } from "../errors";

// The account an entered cost is credited to: where that value was booked
// when it was spent (an expense this year, Retained Earnings for an earlier
// one). Any active posting account of the company group.
export async function getOffsetAccount(
  db: Kysely<DB>,
  companyId: string,
  accountId: string | null | undefined
): Promise<{ id: string; type: AccountType }> {
  if (!accountId) {
    throw new InvalidInputError(
      "Choose the account the cost was booked to when it was spent"
    );
  }
  const account = await db
    .selectFrom("account")
    .innerJoin("company", "company.companyGroupId", "account.companyGroupId")
    .select(["account.id", "account.class"])
    .where("account.id", "=", accountId)
    .where("company.id", "=", companyId)
    .where("account.active", "=", true)
    .where("account.isGroup", "=", false)
    .executeTakeFirst();
  if (!account || !isAccountClass(account.class)) {
    throw new InvalidInputError(
      "The offset account must be an active posting account"
    );
  }
  // The credit is signed by the account's own class (Retained Earnings is
  // Equity), not as the inventory account it replaces.
  return { id: account.id, type: accountTypeFromClass(account.class) };
}
