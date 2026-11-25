// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import { type Expression, type Kysely, type RawBuilder, sql } from "kysely";

/**
 * A timestamptz as the database's fixed-width UTC text, to the microsecond
 * (`2026-11-25T10:00:00.123456Z`). Two values in this form order as strings
 * exactly as the instants order, and no JS `Date` is involved.
 */
export function utcInstant(
  value: Expression<unknown> | RawBuilder<unknown>
): RawBuilder<string | null> {
  return sql<
    string | null
  >`to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * When this run started, from the database clock. Runs on different hosts
 * are ordered by one clock, so app-server skew cannot reorder them.
 */
export async function databaseNow(db: Kysely<DB>): Promise<string> {
  const { rows } = await sql<{
    now: string;
  }>`SELECT ${utcInstant(sql`now()`)} AS "now"`.execute(db);
  const now = rows[0]?.now;
  if (!now) throw new Error("Could not read the database clock");
  return now;
}

/**
 * Whether a run that started reading at `runStartedAt` may save its plan.
 * MRP deletes and rewrites its output, so a run that started later and has
 * already saved read newer inputs: an older run saving after it would put
 * the older plan back. Newest read wins. No run has saved yet (null): save.
 * Both values are `utcInstant` text.
 */
export function newestRunSaves(
  runStartedAt: string,
  lastSavedRunStartedAt: string | null
): boolean {
  return (
    lastSavedRunStartedAt === null || lastSavedRunStartedAt <= runStartedAt
  );
}

/**
 * The start of the last MRP run that saved for the company, as `utcInstant`
 * text. Read under the run's advisory lock. A company with no
 * `companySettings` row has none: its runs save, and nothing is recorded.
 */
export async function lastSavedMrpRunStartedAt(
  db: Kysely<DB>,
  companyId: string
): Promise<string | null> {
  const row = await db
    .selectFrom("companySettings")
    .select(utcInstant(sql.ref("lastMrpRunStartedAt")).as("startedAt"))
    .where("id", "=", companyId)
    .executeTakeFirst();
  return row?.startedAt ?? null;
}

/**
 * The start of the last schedule run that saved the location, as
 * `utcInstant` text. Read under the location's advisory lock. A location no
 * run has saved yet has none.
 */
export async function lastSavedScheduleRunStartedAt(
  db: Kysely<DB>,
  scope: { companyId: string; locationId: string }
): Promise<string | null> {
  const row = await db
    .selectFrom("locationScheduleRun")
    .select(utcInstant(sql.ref("lastRunStartedAt")).as("startedAt"))
    .where("locationId", "=", scope.locationId)
    .where("companyId", "=", scope.companyId)
    .executeTakeFirst();
  return row?.startedAt ?? null;
}
