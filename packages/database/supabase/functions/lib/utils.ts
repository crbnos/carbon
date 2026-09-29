import { CalendarDate, getDayOfWeek } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { KyselyDatabase as DB } from "./postgres/index.ts";
import type { Database } from "./types.ts";

/**
 * Either data-access handle an edge function might hold: a Supabase client
 * (request handlers) or a Kysely handle — the module `db` or an active `trx`.
 * Use it to overload a helper that some callers reach with a client and others
 * with Kysely, instead of maintaining two near-identical `*Db` twins.
 */
export type AnyPostgresClient = SupabaseClient<Database> | Kysely<DB>;

/**
 * Runtime guard narrowing {@link AnyPostgresClient} to the Kysely handle. Kysely
 * exposes `.selectFrom`; the Supabase client does not.
 */
export const isKysely = (db: AnyPostgresClient): db is Kysely<DB> =>
  typeof (db as Kysely<DB>).selectFrom === "function";

// ISO 8601 week number (1-53). Week 1 is the week containing the year's first
// Thursday. The one copy of the algorithm in the functions lib — datetime.ts
// delegates here. Pure calendar arithmetic: en-GB is Monday-first, so
// getDayOfWeek gives Mon=0…Sun=6 and `3 - dow` lands on the week's Thursday;
// CalendarDate.compare returns whole days.
export const isoWeekFromYmd = (
  year: number,
  month: number,
  day: number
): number => {
  const date = new CalendarDate(year, month, day);
  const thursday = date.add({ days: 3 - getDayOfWeek(date, "en-GB") });
  return (
    Math.floor(
      thursday.compare(new CalendarDate(thursday.year, 1, 1)) / 7
    ) + 1
  );
};

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export const credit = (accountType: AccountType, amount: number) => {
  switch (accountType) {
    case "asset":
    case "expense":
      return -amount;
    case "liability":
    case "equity":
    case "revenue":
      return amount;
    default:
      throw new Error(`Invalid account type: ${accountType}`);
  }
};

export const debit = (accountType: AccountType, amount: number) => {
  switch (accountType) {
    case "asset":
    case "expense":
      return amount;
    case "liability":
    case "equity":
    case "revenue":
      return -amount;
    default:
      throw new Error(`Invalid account type: ${accountType}`);
  }
};

// glAccountClass (Asset|Liability|Equity|Revenue|Expense) → the lowercase
// AccountType the debit/credit helpers expect. Shared by the payment and memo
// journal builders so a line's natural-balance sign follows the account's class.
export const accountTypeFromClass = (glClass: string): AccountType => {
  switch (glClass) {
    case "Asset":
      return "asset";
    case "Liability":
      return "liability";
    case "Equity":
      return "equity";
    case "Revenue":
      return "revenue";
    case "Expense":
      return "expense";
    default:
      throw new Error(`Unknown GL account class: ${glClass}`);
  }
};

export const journalReference = {
  to: {
    purchaseInvoice: (id: string) => `purchase-invoice:${id}`,
    receipt: (id: string) => `receipt:${id}`,
    salesInvoice: (id: string) => `sales-invoice:${id}`,
    shipment: (id: string) => `shipment:${id}`,
    job: (id: string) => `job:${id}`,
    materialIssue: (id: string) => `material-issue:${id}`,
    productionEvent: (id: string) => `production-event:${id}`,
  },
};
