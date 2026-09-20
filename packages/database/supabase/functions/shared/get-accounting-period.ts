import { endOfMonth, parseDate, startOfMonth } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import type { DB } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import type { Database } from "../lib/types.ts";

const MONTH_NUMBER: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

type PeriodMode = "historical" | "historical-with-shift" | "current";

function closedPeriodError(mode: PeriodMode, closed: boolean): Error {
  if (mode === "historical") {
    return new Error(
      closed
        ? "The original movement's accounting period is closed — its movements can no longer be corrected."
        : "The original movement's accounting period is locked. Unlock it before posting a correction.",
    );
  }
  return new Error(
    closed
      ? "Accounting period is closed. Reopen it before posting."
      : "Accounting period is locked. Unlock it before posting operational documents.",
  );
}

/** Resolve a posting date and lock its period on the caller's transaction.
 * Historical card imports may shift to the next open period; corrections keep
 * their original date. Only current-period posting changes the Active period.
 */
export async function resolveAccountingPeriod(
  db: Kysely<DB>,
  companyId: string,
  requestedDate: string,
  mode: PeriodMode,
): Promise<{ id: string; postingDate: string }> {
  // Reuse a transaction instead of borrowing a second connection from the
  // edge function's size-one pool. All reads observe the same transaction.
  if (!db.isTransaction) {
    return db.transaction().execute((trx) =>
      resolveAccountingPeriod(trx, companyId, requestedDate, mode)
    );
  }

  const periods = db.selectFrom("accountingPeriod").select([
    "id",
    // DATE decoding differs across the Node and Deno drivers. Keep calendar
    // values as ISO text, without passing through a JavaScript Date.
    sql<string>`"startDate"::text`.as("startDate"),
    "status",
    "closeStatus",
    "closedAt",
  ]).where("companyId", "=", companyId);
  let period = await periods.where("startDate", "<=", requestedDate)
    .where("endDate", ">=", requestedDate)
    .orderBy("startDate").orderBy("id").forUpdate().executeTakeFirst();

  const isClosed = period && (period.closeStatus === "Locked" ||
    period.closeStatus === "Closed" || period.closedAt !== null);
  if (isClosed && mode === "historical-with-shift") {
    period = await periods.where("startDate", ">", requestedDate)
      .where("closeStatus", "=", "Open").where("closedAt", "is", null)
      .orderBy("startDate").orderBy("id").forUpdate().executeTakeFirst();
    if (!period) {
      throw new Error(
        "Accounting period is locked or closed; no open successor exists",
      );
    }
  } else if (period && isClosed) {
    throw closedPeriodError(
      mode,
      period.closeStatus === "Closed" || period.closedAt !== null,
    );
  }

  if (!period) {
    const date = parseDate(requestedDate);
    const fiscalSettings = await db.selectFrom("fiscalYearSettings").select(
      "startMonth",
    )
      .where("companyId", "=", companyId).executeTakeFirst();
    const startMonth = fiscalSettings?.startMonth
      ? (MONTH_NUMBER[fiscalSettings.startMonth] ?? 1)
      : 1;
    const fiscalYear = startMonth === 1 || date.month < startMonth
      ? date.year
      : date.year + 1;
    const periodNumber = ((date.month - startMonth + 12) % 12) + 1;
    // Create inactive, then activate below: this also preserves one active
    // period while simultaneous first-time callers converge on the same row.
    await db.insertInto("accountingPeriod").values({
      startDate: startOfMonth(date).toString(),
      endDate: endOfMonth(date).toString(),
      fiscalYear,
      periodNumber,
      status: "Inactive",
      closeStatus: "Open",
      companyId,
      createdBy: "system",
    }).onConflict((oc) =>
      oc.columns(["companyId", "fiscalYear", "periodNumber"]).doNothing()
    ).execute();
    period = await periods.where("fiscalYear", "=", fiscalYear)
      .where("periodNumber", "=", periodNumber).forUpdate()
      .executeTakeFirstOrThrow();
    if (
      period.closeStatus === "Locked" || period.closeStatus === "Closed" ||
      period.closedAt !== null
    ) {
      throw closedPeriodError(
        mode,
        period.closeStatus === "Closed" || period.closedAt !== null,
      );
    }
  }

  if (mode === "current" && period.status !== "Active") {
    await db.updateTable("accountingPeriod").set({ status: "Inactive" })
      .where("companyId", "=", companyId).where("status", "=", "Active")
      .execute();
    await db.updateTable("accountingPeriod").set({ status: "Active" })
      .where("companyId", "=", companyId).where("id", "=", period.id).execute();
  }
  return {
    id: period.id,
    postingDate:
      mode === "historical-with-shift" && period.startDate > requestedDate
        ? period.startDate
        : requestedDate,
  };
}

/** Original-period corrections retain the existing public calling contract. */
export async function getAccountingPeriodForDate(
  _client: SupabaseClient<Database>,
  companyId: string,
  db: Kysely<DB>,
  date: string,
) {
  return (await resolveAccountingPeriod(db, companyId, date, "historical")).id;
}

/** Pass the same business day used by the caller's journal and ledger rows. */
export async function getCurrentAccountingPeriod(
  client: SupabaseClient<Database>,
  companyId: string,
  db: Kysely<DB>,
  forDate?: string,
) {
  const date = forDate ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();
  return (await resolveAccountingPeriod(db, companyId, date, "current")).id;
}
