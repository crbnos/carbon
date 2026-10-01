// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Kysely, Transaction } from "npm:kysely@0.27.6";
import { DB } from "../database.ts";

export async function getCurrencyByCode(
  db: Kysely<DB> | Transaction<DB>,
  companyGroupId: string,
  currencyCode: string
) {
  return await db
    .selectFrom("currencies")
    .selectAll()
    .where("code", "=", currencyCode)
    .where("companyGroupId", "=", companyGroupId)
    .executeTakeFirst();
}
