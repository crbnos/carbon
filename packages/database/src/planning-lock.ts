// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The company's planning lock. Every writer of planned orders and planning
// actions takes it first, in its transaction: the MRP run's planned-order and
// worklist writes, the settle and conversion of applied Order / Make actions,
// and a person's firm, unfirm, edit or apply. One definition, so the writers
// can never drift onto different keys and interleave.

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./client";

export function planningLockKey(companyId: string): string {
  return `planning-actions:${companyId}`;
}

/** Take the lock in `db`'s transaction (a transaction is a Kysely too). */
export async function lockCompanyPlanning(
  db: Kysely<KyselyDatabase>,
  companyId: string
) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${planningLockKey(companyId)}, 0))`.execute(
    db
  );
}
