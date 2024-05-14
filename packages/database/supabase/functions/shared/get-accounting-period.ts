import { format } from "https://deno.land/std@0.160.0/datetime/mod.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import { Kysely } from "https://esm.sh/kysely@0.26.3";
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

// tries to get the current accounting period
// and if not found, creates a fiscal year and accounting periods
// and updates the active accounting period/fiscal year

export async function getCurrentAccountingPeriod<T>(
  client: SupabaseClient<Database>,
  companyId: string,
  db: Kysely<DB>
) {
  // const d = today(getLocalTimeZone());
  const d = format(new Date(), "yyyy-MM-dd");

  // get the current accounting period
  let currentAccountingPeriod = await client
    .from("accountingPeriod")
    .select("*")
    // .gte("endDate", d.toString())
    // .lte("startDate", d.toString())
    .eq("companyId", companyId)
    .gte("endDate", d)
    .lte("startDate", d)
    .single();

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
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("accountingPeriod")
        .set({ status: "Inactive" })
        .where("status", "=", "Active")
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .updateTable("accountingPeriod")
        .set({ status: "Active" })
        .where("id", "=", currentAccountingPeriod.data!.id)
        .where("companyId", "=", companyId)
        .execute();
    });

    return currentAccountingPeriod.data.id;
  }

  await db.transaction().execute(async (trx) => {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const startDate = `${year}-${month.toString().padStart(2, "0")}-01`;
    let endDate = `${year}-${month.toString().padStart(2, "0")}-${
      daysInMonths[month]
    }`;

    if (month === 2 && isLeapYear(year)) {
      endDate = `${year}-${month.toString().padStart(2, "0")}-29`;
    }

    await trx
      .updateTable("accountingPeriod")
      .set({ status: "Inactive" })
      .where("status", "=", "Active")
      .where("companyId", "=", companyId)
      .execute();

    await trx
      .insertInto("accountingPeriod")
      .values({
        startDate,
        endDate,
        companyId,
        status: "Active",
        createdBy: "system",
      })
      .execute();
  });

  // get the current accounting period now that we've inserted them
  currentAccountingPeriod = await client
    .from("accountingPeriod")
    .select("*")
    // .gte("startDate", d.toString())
    // .lte("endDate", d.toString())
    .gte("endDate", d)
    .lte("startDate", d)
    .eq("companyId", companyId)
    .single();

  if (currentAccountingPeriod.error || !currentAccountingPeriod.data) {
    throw new Error("Current accounting period not found");
  }

  return currentAccountingPeriod.data.id;
}
