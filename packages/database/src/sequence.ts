// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Document-number allocation lives in one place: duplicate implementations
// silently diverge and mint duplicate sequence IDs.
import { CalendarDate, getDayOfWeek, now } from "@internationalized/date";
import { type Kysely, sql, type Transaction } from "kysely";
import type { KyselyDatabase } from "./client.ts";
import { getCompanyTimeZone } from "./timezone.ts";

// ISO 8601 week number (1-53). Week 1 is the week containing the year's first
// Thursday. en-GB is Monday-first, so getDayOfWeek gives Mon=0…Sun=6 and
// `3 - dow` lands on the week's Thursday; CalendarDate.compare returns whole days.
const isoWeekFromYmd = (year: number, month: number, day: number): number => {
  const date = new CalendarDate(year, month, day);
  const thursday = date.add({ days: 3 - getDayOfWeek(date, "en-GB") });
  return (
    Math.floor(thursday.compare(new CalendarDate(thursday.year, 1, 1)) / 7) + 1
  );
};

// Date tokens derive in the company's business timezone so document prefixes
// roll over at the company's midnight, not the process's. The ERP's live
// preview (`interpolateSequenceDate` in apps/erp/app/utils/string.ts) mirrors
// this — keep the two in sync, along with get_next_sequence (SQL),
// interpolate_serial_segment (SQL, the serial numbers' tokens) and
// util.document_sequence_pattern (src/event-system/functions), which reads a
// saved number back to keep the counter ahead of it.
const interpolateSequenceDate = (value?: string | null, timezone = "UTC") => {
  if (!value) return "";
  let result = value;

  if (result.includes("%{")) {
    const { year, month, day, hour: hours, second: seconds } = now(timezone);
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

export async function getNextSequence(
  trx: Transaction<KyselyDatabase>,
  tableName: string,
  companyId: string
): Promise<string> {
  const [sequence] = await getNextSequences(trx, tableName, companyId, 1);
  if (sequence === undefined) throw new Error("No sequence number allocated");
  return sequence;
}

/**
 * `count` numbers of one sequence in a single statement, in order.
 *
 * Atomic increment: the UPDATE takes the row lock before reading, so two
 * concurrent transactions can't both read the same "next" and return the same
 * sequence number. Date tokens in the prefix and suffix roll over at the
 * COMPANY's midnight — document numbering is ledger-scoped.
 */
export async function getNextSequences(
  trx: Transaction<KyselyDatabase>,
  tableName: string,
  companyId: string,
  count: number
): Promise<string[]> {
  if (count <= 0) return [];
  const sequence = await trx
    .updateTable("sequence")
    .set({
      next: sql<number>`"next" + "step" * ${count}`,
      updatedBy: "system"
    })
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .returning(["next", "step", "prefix", "suffix", "size"])
    .executeTakeFirstOrThrow();

  const { prefix, suffix, next, step, size } = sequence;
  if (!Number.isInteger(next)) throw new Error("Next is not an integer");
  if (!Number.isInteger(step)) throw new Error("Step is not an integer");
  if (!Number.isInteger(size)) throw new Error("Size is not an integer");

  const timezone = await getCompanyTimeZone(trx, companyId);
  const derivedPrefix = interpolateSequenceDate(prefix, timezone);
  const derivedSuffix = interpolateSequenceDate(suffix, timezone);
  const first = next! - step! * (count - 1);
  return Array.from(
    { length: count },
    (_, index) =>
      `${derivedPrefix}${(first + step! * index).toString().padStart(size!, "0")}${derivedSuffix}`
  );
}

export async function getNextRevisionSequence(
  trx: Transaction<KyselyDatabase>,
  tableName: string,
  sequenceColumn: string,
  sequenceValue: string,
  companyId: string
) {
  // There is no counter row to lock — the next revision is max(revisionId) + 1,
  // and a concurrent transaction's uncommitted insert is invisible to us. An
  // advisory transaction lock serializes revision creation per entity so two
  // transactions can't both compute the same max.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`revision:${tableName}:${sequenceColumn}:${sequenceValue}:${companyId}`}, 0))`.execute(
    trx
  );

  const relatedSequences = await trx
    // @ts-ignore - we're using variables for table names
    .selectFrom(tableName)
    // @ts-ignore - we're using variables for column names
    .select(["revisionId"])
    // @ts-ignore - we're using variables for column names
    .where(sequenceColumn, "=", sequenceValue)
    .where("companyId", "=", companyId)
    // @ts-ignore - we're using variables for column names
    .orderBy("revisionId", "desc")
    .execute();

  if (relatedSequences.length === 0 || !("revisionId" in relatedSequences[0])) {
    return 1;
  }

  return (relatedSequences[0].revisionId ?? 0) + 1;
}

/**
 * Atomically reserve and format the next `count` serial numbers for an item from
 * its configured `itemSerialSequence`, through the SQL `get_next_serial_numbers`.
 * Returns `[]` when the item has no sequence (so callers leave `readableId` null,
 * exactly as before). Runs inside the caller's Kysely transaction, so the counter
 * reservation commits — or rolls back — together with the write that consumes
 * the numbers.
 *
 * Each number interpolates the date/week tokens (%{yyyy} %{yy} %{mm} %{ww} %{dd}
 * %{hh} %{ss}) in the company's timezone, plus %{location} (location.code,
 * falling back to the location name).
 *
 * Used by `assign-serial-numbers` (the N units that exist at job creation),
 * `issue` (a unit spawned lazily on completion, e.g. after the job quantity was
 * increased) and the `serialNumberTiming = 'production'` first-touch paths
 * (`assignSerialNumberIfMissing`, the ERP completion), so serials follow the
 * pattern regardless of when the entity is numbered.
 */
export async function getNextSerialNumbers(
  trx: Transaction<KyselyDatabase>,
  args: {
    itemId: string;
    companyId: string;
    count: number;
    locationCode?: string | null;
    locationName?: string | null;
  }
): Promise<string[]> {
  if (args.count < 1) return [];
  // One allocator: get_next_serial_numbers formats in SQL, so the database's
  // own completion path (number_serial_units_for_completion) and every
  // TypeScript caller produce the same numbers.
  const result = await sql<{ serials: string[] | null }>`
    SELECT get_next_serial_numbers(
      ${args.itemId},
      ${args.companyId},
      ${args.count}::integer,
      ${args.locationCode ?? null},
      ${args.locationName ?? null}
    ) AS serials
  `.execute(trx);
  return result.rows[0]?.serials ?? [];
}

/**
 * When a produced unit draws its serial number: `jobCreation` (the default)
 * numbers every unit when the job is created; `production` leaves the job's
 * units unnumbered and numbers each one the first time it is touched (its first
 * production event, its first operation completion, its scrap, or the receipt
 * that completes the job). Read with a failure falling back to the default,
 * which is what every company had before the setting existed.
 */
export async function getSerialNumberTiming(
  db: Transaction<KyselyDatabase> | Kysely<KyselyDatabase>,
  companyId: string
): Promise<"jobCreation" | "production"> {
  const settings = await db
    .selectFrom("companySettings")
    .select(["serialNumberTiming"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  return settings?.serialNumberTiming === "production"
    ? "production"
    : "jobCreation";
}

/**
 * Number ONE tracked entity from its item's `itemSerialSequence`, if it has no
 * number yet. Returns the assigned serial, or null when nothing was assigned:
 * the entity is already numbered, has no item, or its item has no sequence.
 *
 * This is the `serialNumberTiming = 'production'` path, so every call site is a
 * "first touch" hook and must be safe to fire repeatedly on the same unit:
 * hence the `readableId IS NULL` guard and the row lock. Two operators touching
 * the same unit at once serialize on the entity row, and the second sees the
 * first one's number instead of reserving and burning another. Runs inside the
 * caller's transaction, so the counter reservation commits or rolls back with
 * the write that prompted it.
 */
export async function assignSerialNumberIfMissing(
  trx: Transaction<KyselyDatabase>,
  args: { trackedEntityId: string; companyId: string }
): Promise<string | null> {
  const entity = await trx
    .selectFrom("trackedEntity")
    .select(["id", "itemId", "readableId", "attributes"])
    .where("id", "=", args.trackedEntityId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();

  if (!entity || entity.readableId || !entity.itemId) return null;

  const [readableId] = await getNextSerialNumbers(trx, {
    itemId: entity.itemId,
    companyId: args.companyId,
    count: 1,
    ...(await getEntityJobLocation(trx, entity.attributes, args.companyId))
  });
  if (!readableId) return null;

  await trx
    .updateTable("trackedEntity")
    .set({ readableId })
    .where("id", "=", entity.id)
    .where("companyId", "=", args.companyId)
    .execute();

  return readableId;
}

/**
 * The %{location} context for a job's unit: the location of the job named by
 * its `Job` attribute. A unit with no Job attribute interpolates the token to
 * nothing, as it would at job creation for a job with no location.
 */
export async function getEntityJobLocation(
  trx: Transaction<KyselyDatabase>,
  attributes: unknown,
  companyId: string
): Promise<{ locationCode: string | null; locationName: string | null }> {
  const jobId = (attributes as Record<string, unknown> | null)?.Job;
  if (typeof jobId !== "string") {
    return { locationCode: null, locationName: null };
  }
  const location = await trx
    .selectFrom("job")
    .innerJoin("location", "location.id", "job.locationId")
    .select(["location.code as code", "location.name as name"])
    .where("job.id", "=", jobId)
    .where("job.companyId", "=", companyId)
    .executeTakeFirst();
  return {
    locationCode: location?.code ?? null,
    locationName: location?.name ?? null
  };
}
