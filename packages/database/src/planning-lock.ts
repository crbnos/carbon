// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The company's planning locks. Two, always taken in this order:
//
// 1. The MRP run lock (`lockCompanyMrpRun`). An MRP run takes it first and
//    holds it until the run ends, so two runs of one company never overlap
//    (each would invalidate the other's planned-order snapshot).
// 2. The planning lock (`lockCompanyPlanning`). Every writer of planned
//    orders and planning actions takes it first, in its transaction: the MRP
//    run's planned-order and worklist writes, the settle and conversion of
//    applied Order / Make actions, and a person's firm, unfirm, edit or apply.
//
// A run holds 1 and then takes 2 briefly, on another connection. Nothing that
// holds 2 ever waits for 1: a person takes 2 only, and a run takes 2 only
// while it already holds 1. So the two locks cannot deadlock. One definition
// of each key, so the writers can never drift onto different keys.

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

export function mrpRunLockKey(companyId: string): string {
  return `mrp-run:${companyId}`;
}

/**
 * Take the MRP run lock in `db`'s transaction. The transaction must stay open
 * for the whole run and do nothing else: the run's own reads and writes go on
 * other connections. Take it before the planning lock, never after.
 */
export async function lockCompanyMrpRun(
  db: Kysely<KyselyDatabase>,
  companyId: string
) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${mrpRunLockKey(companyId)}, 0))`.execute(
    db
  );
}
