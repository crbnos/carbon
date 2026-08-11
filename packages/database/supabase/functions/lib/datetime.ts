// Deno mirror of packages/utils/src/datetime.ts — edge functions cannot import
// workspace packages, so the ~40-line module is duplicated with the same API.
// Keep the two files in sync. One deliberate delta: the Node copy also has
// `weekBounds` (payroll/timecard week windows) — no edge function needs it
// yet; mirror it in when one does.
import {
  type CalendarDate,
  now,
  parseAbsolute,
  toCalendarDate,
  today
} from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { DB } from "./database.ts";
import { type AnyPostgresClient, isKysely, isoWeekFromYmd } from "./utils.ts";
import type { Database } from "./types.ts";

/**
 * ISO 8601 week number (1-53). Week 1 is the week containing the year's first
 * Thursday. Delegates to the single algorithm in ./utils.ts.
 */
function weekNumber(date: CalendarDate): number {
  return isoWeekFromYmd(date.year, date.month, date.day);
}

/**
 * The one sanctioned way to derive dates and times in edge functions.
 *
 * Every derivation method takes a mandatory IANA timezone — resolved from
 * `company.timezone` (ledger-scoped: accounting periods, posting dates,
 * sequence date tokens) or `location.timezone` (operational: scheduling,
 * shifts, MES) — so "which calendar day is it?" is never answered implicitly
 * by the process timezone.
 */
export const datetime = {
  /** UTC instant string for timestamp columns (createdAt/updatedAt). The only timezone-free method. */
  timestamp: () => new Date().toISOString(),

  /** Current moment as a ZonedDateTime in the given business timezone. */
  now: (tz: string) => now(tz),

  /** Today as a CalendarDate in the given business timezone. */
  today: (tz: string) => today(tz),

  /** The business day a stored UTC instant falls on in the given timezone. */
  businessDay: (instant: string, tz: string) =>
    toCalendarDate(parseAbsolute(instant, tz)),

  weekNumber
};

// Both resolvers accept EITHER a Supabase client (request handlers) or a Kysely
// handle (transaction-only functions with no client) via AnyPostgresClient/isKysely.
// Pass the active `trx` when resolving inside a Kysely transaction — the pool is
// size 1, so reading via the module `db` while a `trx` holds the connection would
// deadlock; the Supabase client is a separate connection and is always safe.

/** Ledger-scoped timezone: one calendar per set of books. Falls back to UTC. */
export function getCompanyTimeZone(
  db: SupabaseClient<Database>,
  companyId: string
): Promise<string>;
export function getCompanyTimeZone(
  db: Kysely<DB>,
  companyId: string
): Promise<string>;
export async function getCompanyTimeZone(
  db: AnyPostgresClient,
  companyId: string
): Promise<string> {
  if (isKysely(db)) {
    const row = await db
      .selectFrom("company")
      .select("timezone")
      .where("id", "=", companyId)
      .executeTakeFirst();
    return row?.timezone ?? "UTC";
  }
  const company = await db
    .from("company")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle();
  // A failed read must not silently become a (wrong) business calendar —
  // fall back to UTC only when the query succeeded and found nothing.
  if (company.error) {
    throw new Error(
      `Failed to resolve company timezone: ${company.error.message}`
    );
  }
  return company.data?.timezone ?? "UTC";
}

/** Operational timezone of a physical site. Falls back to the company timezone. */
export function getLocationTimeZone(
  db: SupabaseClient<Database>,
  locationId: string,
  companyId: string
): Promise<string>;
export function getLocationTimeZone(
  db: Kysely<DB>,
  locationId: string,
  companyId: string
): Promise<string>;
export async function getLocationTimeZone(
  db: AnyPostgresClient,
  locationId: string,
  companyId: string
): Promise<string> {
  if (isKysely(db)) {
    const row = await db
      .selectFrom("location")
      .select("timezone")
      .where("id", "=", locationId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    return row?.timezone || getCompanyTimeZone(db, companyId);
  }
  const location = await db
    .from("location")
    .select("timezone")
    .eq("id", locationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (location.error) {
    throw new Error(
      `Failed to resolve location timezone: ${location.error.message}`
    );
  }
  return location.data?.timezone || getCompanyTimeZone(db, companyId);
}
