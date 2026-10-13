// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { readAccountingCutoverDate } from "@carbon/database/journal-posting-status";
import type { Kysely, Transaction } from "kysely";
import { InvalidInputError } from "../errors";

// Manual accounting work (recognition runs here) runs only after the
// company's accounting cutover: before it, journals are Provisional and count
// nowhere (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 1). The ERP
// service functions refuse the same work with the same message.
export const ACCOUNTING_NOT_STARTED =
  "Set up accounting before you post journals, runs or period closes.";

export async function assertAccountingCutover(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string
) {
  if (!(await readAccountingCutoverDate(db, companyId))) {
    throw new InvalidInputError(ACCOUNTING_NOT_STARTED);
  }
}
