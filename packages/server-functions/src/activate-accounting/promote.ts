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
import {
  configuredDefaultAccount,
  MissingAccountDefaultError,
  OPTIONAL_DEFAULT_ROLES,
  type OptionalDefaultRole
} from "@carbon/database/journal-posting-status";
import { datetime } from "@carbon/utils";
import { endOfMonth, parseDate, startOfMonth } from "@internationalized/date";
import { sql } from "kysely";
import { ServerFnError } from "../errors";
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
      AND j."id" IN (${scopedJournals(trx, companyId, scope)})
      AND j."postingDate" BETWEEN v."start" AND v."end"
  `.execute(trx);
}

const OPTIONAL_DEFAULTS: ReadonlySet<string> = new Set(OPTIONAL_DEFAULT_ROLES);
const isOptionalDefaultRole = (role: string): role is OptionalDefaultRole =>
  OPTIONAL_DEFAULTS.has(role);

/**
 * Step 12. A stand-in line sits on retained earnings and names the default it
 * wanted. Before promotion it moves to that default, one UPDATE per role. An
 * intercompany elimination line copies the account of the journal line it
 * mirrors (post-sales-invoice and post-purchase-invoice copy it when they
 * post), so it moves with its line.
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
    if (!isOptionalDefaultRole(role)) {
      throw new ServerFnError(
        `A journal line names ${role}, which is not an account default a stand-in line can wait for.`
      );
    }
    // A role with a fallback resolves to it, as a posting today would.
    const accountId = configuredDefaultAccount(defaults, role);
    if (!accountId) throw new MissingAccountDefaultError(role);
    const standIns = trx
      .selectFrom("journalLine")
      .select("id")
      .where("companyId", "=", companyId)
      .where("accountDefaultRole", "=", role)
      .where("journalId", "in", staying);
    await trx
      .updateTable("intercompanyEliminationLine")
      .set({ accountId })
      .where("companyId", "=", companyId)
      .where("journalLineId", "in", standIns)
      .where("accountId", "=", defaults.retainedEarningsAccount)
      .execute();
    await trx
      .updateTable("journalLine")
      .set({ accountId, accountDefaultRole: null })
      .where("companyId", "=", companyId)
      .where("accountDefaultRole", "=", role)
      .where("journalId", "in", staying)
      .execute();
  }
}

/** Step 13. Promotes the Provisional journals in the scope to Posted. */
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
