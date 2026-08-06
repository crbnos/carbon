import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { KyselyDatabase } from "./client.ts";
import type { Database } from "./types.ts";
import { type AnyPostgresClient, isKysely } from "./utils.ts";

/**
 * Ledger-scoped timezone: one calendar per set of books. Accounting periods,
 * posting dates, and sequence date tokens derive their business day here —
 * never from the process timezone. Falls back to UTC. Accepts a Supabase client
 * or a Kysely handle (pass an active `trx` when resolving inside a transaction).
 */
export function getCompanyTimeZone(
  db: SupabaseClient<Database>,
  companyId: string
): Promise<string>;
export function getCompanyTimeZone(
  db: Kysely<KyselyDatabase>,
  companyId: string
): Promise<string>;
/** For callers holding an un-narrowed handle (e.g. a caching wrapper). */
export function getCompanyTimeZone(
  db: AnyPostgresClient,
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

/**
 * Operational timezone of a physical site — scheduling, shifts, MES
 * day-grouping. Falls back to the company timezone when the location is
 * missing or has no timezone.
 */
export function getLocationTimeZone(
  db: SupabaseClient<Database>,
  locationId: string,
  companyId: string
): Promise<string>;
export function getLocationTimeZone(
  db: Kysely<KyselyDatabase>,
  locationId: string,
  companyId: string
): Promise<string>;
/** For callers holding an un-narrowed handle (e.g. a caching wrapper). */
export function getLocationTimeZone(
  db: AnyPostgresClient,
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

/**
 * The timezone a location DEFINES ITSELF, or null when it inherits the
 * company's (missing row, null, or legacy empty-string value). For callers
 * that must distinguish own-vs-inherited — e.g. the ERP Redis cache, which
 * must never store an inherited company timezone under a location key.
 */
export async function getLocationOwnTimeZone(
  db: AnyPostgresClient,
  locationId: string,
  companyId: string
): Promise<string | null> {
  if (isKysely(db)) {
    const row = await db
      .selectFrom("location")
      .select("timezone")
      .where("id", "=", locationId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    return row?.timezone || null;
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
  return location.data?.timezone || null;
}
