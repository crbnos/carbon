// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The last steps a Provisional journal takes to the ledger
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5, steps 8 and 9): the
// period of its date, its stand-in lines moved to the defaults they stand in
// for, and the promotion to Posted. The enable runs them for every
// Provisional journal dated on or after the cutover; `journal-legacy-documents`
// runs them for the journals it wrote, by id.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import { endOfMonth, parseDate, startOfMonth } from "@internationalized/date";
import { sql } from "kysely";
import { InvalidInputError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/**
 * The Provisional journals a step takes: those dated on or after the cutover
 * (the enable), or the ones with these ids (a repair after the enable).
 */
export type JournalScope =
  | { cutoverDate: string }
  | { journalIds: readonly string[] };

/** The ids of the Provisional journals in the scope, as a subquery. */
function scopedJournals(trx: KyselyTx, companyId: string, scope: JournalScope) {
  const provisional = trx
    .selectFrom("journal")
    .select("id")
    .where("companyId", "=", companyId)
    .where("status", "=", "Provisional");
  return "cutoverDate" in scope
    ? provisional.where("postingDate", ">=", scope.cutoverDate)
    : // One array parameter, whatever the number of ids.
      provisional.where("id", "=", sql<string>`ANY(${[...scope.journalIds]})`);
}

/**
 * Step 11. Gives every Provisional journal in the scope the period that
 * holds its date, resolving each month once.
 */
export async function assignPeriods(
  trx: KyselyTx,
  companyId: string,
  scope: JournalScope
) {
  const dates = await trx
    .selectFrom("journal")
    .select("postingDate")
    .distinct()
    .where("companyId", "=", companyId)
    .where("id", "in", scopedJournals(trx, companyId, scope))
    .execute();
  const months = new Map<string, { start: string; end: string }>();
  for (const { postingDate } of dates) {
    const date = parseDate(String(postingDate));
    const start = startOfMonth(date).toString();
    months.set(start, { start, end: endOfMonth(date).toString() });
  }
  if (months.size === 0) return;

  const periods: { start: string; end: string; periodId: string }[] = [];
  for (const month of months.values()) {
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      month.start,
      "historical"
    );
    periods.push({ ...month, periodId: period.id });
  }
  const inScope =
    "cutoverDate" in scope
      ? sql`j."postingDate" >= ${scope.cutoverDate}`
      : sql`j."id" = ANY(${[...scope.journalIds]})`;
  await sql`
    UPDATE "journal" AS j
    SET "accountingPeriodId" = v."periodId"
    FROM (VALUES ${sql.join(
      periods.map(
        (period) =>
          sql`(${period.start}::date, ${period.end}::date, ${period.periodId})`
      )
    )}) AS v("start", "end", "periodId")
    WHERE j."companyId" = ${companyId}
      AND j."status" = 'Provisional'
      AND ${inScope}
      AND j."postingDate" BETWEEN v."start" AND v."end"
  `.execute(trx);
}

/**
 * Step 13. A stand-in line sits on retained earnings and names the default it
 * wanted. Before promotion it moves to that default, one UPDATE per role.
 */
export async function repointStandInLines(
  trx: KyselyTx,
  companyId: string,
  scope: JournalScope,
  defaults: AccountDefaults
) {
  const staying = scopedJournals(trx, companyId, scope);
  const roles = await trx
    .selectFrom("journalLine")
    .select("accountDefaultRole")
    .distinct()
    .where("companyId", "=", companyId)
    .where("accountDefaultRole", "is not", null)
    .where("journalId", "in", staying)
    .execute();
  for (const { accountDefaultRole: role } of roles) {
    if (!role) continue;
    const accountId = (defaults as Record<string, unknown>)[role];
    if (typeof accountId !== "string" || !accountId) {
      throw new InvalidInputError(`Set the ${role} account default.`);
    }
    await trx
      .updateTable("journalLine")
      .set({ accountId, accountDefaultRole: null })
      .where("companyId", "=", companyId)
      .where("accountDefaultRole", "=", role)
      .where("journalId", "in", staying)
      .execute();
  }
}

/** Step 14. Promotes the Provisional journals in the scope to Posted. */
export async function promoteJournals(
  trx: KyselyTx,
  companyId: string,
  userId: string,
  scope: JournalScope
) {
  const now = datetime.timestamp();
  await trx
    .updateTable("journal")
    .set({
      status: "Posted",
      postedAt: now,
      postedBy: userId,
      updatedBy: userId,
      updatedAt: now
    })
    .where("companyId", "=", companyId)
    .where("id", "in", scopedJournals(trx, companyId, scope))
    .execute();
}
