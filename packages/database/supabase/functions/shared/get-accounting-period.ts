import { SupabaseClient } from "@supabase/supabase-js";
import { format } from "https://deno.land/std@0.160.0/datetime/mod.ts";
import { Kysely } from "kysely";
import { DB } from "../lib/database.ts";
import { Database } from "../lib/types.ts";

// TODO: refactor to use @internationalized/date when npm:<package>@<version> is supported
const isLeapYear = (year: number) => {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
};

const daysInMonths: Record<number, number> = {
  1: 31,
  2: 28,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
};

// Mirrors MONTH_NUMBER / fiscalYearAndPeriodFor in @carbon/utils (which can't be
// imported into a Deno edge function). Fiscal year is named by its ending
// calendar year (FY2026 = the year ending in 2026); periodNumber is 1..12
// counted from the fiscal start month.
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

function fiscalYearAndPeriodFor(
  year: number,
  month: number,
  startMonth: number
): { fiscalYear: number; periodNumber: number } {
  const periodNumber = ((month - startMonth + 12) % 12) + 1;
  const fiscalYear =
    startMonth === 1 ? year : month >= startMonth ? year + 1 : year;
  return { fiscalYear, periodNumber };
}

// Run `fn` inside a transaction, reusing `db` when it is already one.
// The edge-function connection pool is size 1, so opening a nested
// `db.transaction()` while the caller already holds the pool's only connection
// would wait forever for a second connection and the isolate would be killed
// (wall-clock timeout). Callers already inside a transaction must therefore pass
// their `trx` so we reuse it; callers that resolve the period before starting a
// transaction pass the pool and we open one (the pre-existing behavior).
async function runInTransaction<R>(
  db: Kysely<DB>,
  fn: (trx: Kysely<DB>) => Promise<R>
): Promise<R> {
  return db.isTransaction ? fn(db) : db.transaction().execute(fn);
}

// tries to get the current accounting period
// and if not found, creates a fiscal year and accounting periods
// and updates the active accounting period/fiscal year
//
// Pass the caller's transaction (`trx`) as `db` when calling from inside a
// transaction — see runInTransaction above.
export async function getCurrentAccountingPeriod<T>(
  client: SupabaseClient<Database>,
  companyId: string,
  db: Kysely<DB>
) {
  // const d = today(getLocalTimeZone());
  const d = format(new Date(), "yyyy-MM-dd");

  // get the current accounting period
  const currentAccountingPeriod = await client
    .from("accountingPeriod")
    .select("*")
    // .gte("endDate", d.toString())
    // .lte("startDate", d.toString())
    .eq("companyId", companyId)
    .gte("endDate", d)
    .lte("startDate", d)
    .single();

  // Operational posting (receipts, shipments, invoices, payments) is not
  // allowed into a Locked or Closed period. The close-lifecycle columns are
  // cloud-generated and not yet in the committed types, so read through a cast.
  if (currentAccountingPeriod.data) {
    const closeStatus =
      (
        currentAccountingPeriod.data as unknown as {
          closeStatus?: string | null;
        }
      ).closeStatus ??
      (currentAccountingPeriod.data.closedAt ? "Closed" : "Open");

    if (closeStatus === "Closed") {
      throw new Error("Accounting period is closed. Reopen it before posting.");
    }

    if (closeStatus === "Locked") {
      throw new Error(
        "Accounting period is locked. Unlock it before posting operational documents."
      );
    }
  }

  if (
    currentAccountingPeriod.data &&
    currentAccountingPeriod.data.status === "Active"
  ) {
    return currentAccountingPeriod.data.id;
  }

  if (
    currentAccountingPeriod.data &&
    currentAccountingPeriod.data.status === "Inactive"
  ) {
    const periodId = currentAccountingPeriod.data.id;
    await runInTransaction(db, async (trx) => {
      await trx
        .updateTable("accountingPeriod")
        .set({ status: "Inactive" })
        .where("status", "=", "Active")
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .updateTable("accountingPeriod")
        .set({ status: "Active" })
        .where("id", "=", periodId)
        .where("companyId", "=", companyId)
        .execute();
    });

    return periodId;
  }

  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
  let endDate = `${year}-${month.toString().padStart(2, "0")}-${
    daysInMonths[month]
  }`;

  if (month === 2 && isLeapYear(year)) {
    endDate = `${year}-${month.toString().padStart(2, "0")}-29`;
  }

  // Stamp the fiscal-year label / period number from the company's fiscal start
  // month (defaults to January) so lazily-created periods match the app-service
  // path (getOrCreateAccountingPeriod) and don't land NULL.
  const fiscalYearSettings = await client
    .from("fiscalYearSettings")
    .select("startMonth")
    .eq("companyId", companyId)
    .maybeSingle();
  const startMonth = fiscalYearSettings.data?.startMonth
    ? (MONTH_NUMBER[fiscalYearSettings.data.startMonth] ?? 1)
    : 1;
  const { fiscalYear, periodNumber } = fiscalYearAndPeriodFor(
    year,
    month,
    startMonth
  );

  const newPeriod = await runInTransaction(db, async (trx) => {
    await trx
      .updateTable("accountingPeriod")
      .set({ status: "Inactive" })
      .where("status", "=", "Active")
      .where("companyId", "=", companyId)
      .execute();

    return await trx
      .insertInto("accountingPeriod")
      .values({
        startDate,
        endDate,
        companyId,
        status: "Active",
        // Lazily-created periods start Open; close-lifecycle columns are
        // cloud-generated and not yet in the committed Kysely types, hence the
        // cast.
        closeStatus: "Open",
        fiscalYear,
        periodNumber,
        createdBy: "system",
      } as any)
      .returning("id")
      .executeTakeFirstOrThrow();
  });

  return newPeriod.id;
}
