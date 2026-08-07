// Bare specifier on purpose: Deno resolves it through the deno.json import map
// (like kysely), and the node-side @carbon/database build — which reaches this
// file via shared/get-next-sequence.ts — resolves it from node_modules.
import { CalendarDate, getDayOfWeek, now } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
// Type-only import from postgres/index.ts (not lib/database.ts) keeps the
// Deno-only driver out of the graph — this file is reached from the node-side
// @carbon/database build via shared/get-next-sequence.ts.
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

export interface TrackedEntityAttributes {
  "Batch Number"?: string;
  Customer?: string;
  "Job Operation"?: string;
  "Job Operation Index"?: number;
  "Purchase Order"?: string;
  "Receipt Line Index"?: number;
  "Receipt Line"?: string;
  Receipt?: string;
  Supplier?: string;
  "Serial Number"?: string;
  "Shipment Line Index"?: number;
  "Shipment Line"?: string;
  Shipment?: string;
  "Split Entity ID"?: string;
  "Split From Entity ID"?: string;
  Shelf?: string;
}

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

// used to generate sequences — date tokens derive in the company's business
// timezone so document prefixes roll over at the company's midnight, not the
// process's
export const interpolateSequenceDate = (
  value?: string | null,
  timezone = "UTC"
) => {
  // replace all instances of %{year} with the current year
  if (!value) return "";
  let result = value;

  if (result.includes("%{")) {
    const {
      year,
      month,
      day,
      hour: hours,
      second: seconds
    } = now(timezone);
    const week = isoWeekFromYmd(year, month, day);

    result = result.replace(/%{yyyy}/g, year.toString());
    result = result.replace(/%{yy}/g, year.toString().slice(-2));
    result = result.replace(/%{mm}/g, month.toString().padStart(2, "0"));
    result = result.replace(/%{ww}/g, week.toString().padStart(2, "0"));
    result = result.replace(/%{dd}/g, day.toString().padStart(2, "0"));
    result = result.replace(/%{hh}/g, hours.toString().padStart(2, "0"));
    result = result.replace(/%{ss}/g, seconds.toString().padStart(2, "0"));
  }

  return result;
};

// Serial-number segment interpolation: the date/week tokens above, plus the
// job-context %{location} token (location.code, falling back to location.name).
export const interpolateSerialNumber = (
  value: string | null | undefined,
  context: {
    locationCode?: string | null;
    locationName?: string | null;
    timezone?: string;
  }
) => {
  const withDates = interpolateSequenceDate(value, context.timezone);
  if (!withDates.includes("%{location}")) return withDates;
  const location = (context.locationCode ?? context.locationName ?? "").trim();
  return withDates.replace(/%{location}/g, location);
};

export const getReadableIdWithRevision = (
  readableId: string,
  revision?: string | null
) => {
  if (revision && revision !== "0") {
    return `${readableId}.${revision}`;
  }

  return readableId;
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
