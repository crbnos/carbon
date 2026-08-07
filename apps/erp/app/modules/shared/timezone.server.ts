import type { AnyPostgresClient } from "@carbon/database";
import {
  getLocationOwnTimeZone,
  getCompanyTimeZone as resolveCompanyTimeZone
} from "@carbon/database";
import { redis } from "@carbon/kv";

// Timezones change only when someone edits Settings → Company or a location, so
// a long TTL is fine — writes invalidate the key explicitly (below). The
// @carbon/kv resilience wrapper fails soft: a Redis miss/outage/corrupt value
// just falls through to the database read.
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const companyKey = (companyId: string) => `timezone:company:${companyId}`;
const locationKey = (companyId: string, locationId: string) =>
  `timezone:location:${companyId}:${locationId}`;

// Cached marker for "this location defines no timezone of its own". The
// location cache must never store an INHERITED company timezone: that copy
// would survive invalidateCompanyTimeZone for up to 7 days. Instead the
// inherit case is cached as this sentinel and the fallback flows through the
// (invalidatable) company cache on every read.
const INHERIT = "__inherit__";

/** Redis-cached {@link resolveCompanyTimeZone}. */
export async function getCompanyTimeZone(
  db: AnyPostgresClient,
  companyId: string
): Promise<string> {
  const key = companyKey(companyId);
  const cached = await redis.get(key);
  if (cached) return cached;

  const tz = await resolveCompanyTimeZone(db, companyId);
  await redis.set(key, tz, "EX", TTL_SECONDS);
  return tz;
}

/**
 * Redis-cached location timezone with company fallback. Only the location's
 * OWN timezone is cached under the location key (company-scoped); a location
 * that inherits resolves through {@link getCompanyTimeZone} on every call, so
 * a company-timezone change takes effect immediately after its invalidation.
 */
export async function getLocationTimeZone(
  db: AnyPostgresClient,
  locationId: string,
  companyId: string
): Promise<string> {
  const key = locationKey(companyId, locationId);
  const cached = await redis.get(key);
  if (cached !== null) {
    return cached === INHERIT ? getCompanyTimeZone(db, companyId) : cached;
  }

  const own = await getLocationOwnTimeZone(db, locationId, companyId);
  await redis.set(key, own ?? INHERIT, "EX", TTL_SECONDS);
  return own ?? getCompanyTimeZone(db, companyId);
}

/** Drop the cached company timezone — call after writing `company.timezone`. */
export async function invalidateCompanyTimeZone(
  companyId: string
): Promise<void> {
  await redis.del(companyKey(companyId));
}

/** Drop the cached location timezone — call after writing `location.timezone`. */
export async function invalidateLocationTimeZone(
  locationId: string,
  companyId: string
): Promise<void> {
  await redis.del(locationKey(companyId, locationId));
}
