// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Document-number allocation lives in one place: duplicate implementations
// silently diverge and mint duplicate sequence IDs.
import { CalendarDate, getDayOfWeek, now } from "@internationalized/date";
import { type Kysely, sql, type Transaction } from "kysely";
import type { KyselyDatabase } from "./client.ts";
import {
  asSerialNumberTiming,
  type SerialNumberTiming
} from "./serial-number-timing.ts";
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
  // own completion path (complete_job_to_inventory) and every
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

export {
  type SerialNumberTiming,
  serialNumberTimings
} from "./serial-number-timing.ts";

/**
 * When a produced unit draws its serial number: `jobCreation` (the default)
 * numbers every unit when the job is created; `jobRelease` when the job is
 * released to the shop floor; `production` leaves the job's units unnumbered
 * and numbers each one the first time it is touched (its first production
 * event, its first operation completion, its scrap, or the receipt that
 * completes the job).
 *
 * With an item, its serial sequence's own timing wins and the company's is the
 * default. Anything unreadable falls back to `jobCreation`, which is what every
 * company had before the setting existed.
 */
export async function getSerialNumberTiming(
  db: Transaction<KyselyDatabase> | Kysely<KyselyDatabase>,
  companyId: string,
  itemId?: string | null
): Promise<SerialNumberTiming> {
  if (!itemId) return resolveSerialNumberTiming(db, companyId, null);
  const sequence = await db
    .selectFrom("itemSerialSequence")
    .select(["serialNumberTiming"])
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return resolveSerialNumberTiming(db, companyId, sequence?.serialNumberTiming);
}

/**
 * The timing for an item whose sequence's own `serialNumberTiming` the caller
 * already read: that value when it is set, else the company's.
 */
export async function resolveSerialNumberTiming(
  db: Transaction<KyselyDatabase> | Kysely<KyselyDatabase>,
  companyId: string,
  itemTiming: unknown
): Promise<SerialNumberTiming> {
  const own = asSerialNumberTiming(itemTiming);
  if (own) return own;
  const settings = await db
    .selectFrom("companySettings")
    .select(["serialNumberTiming"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  return asSerialNumberTiming(settings?.serialNumberTiming) ?? "jobCreation";
}

/**
 * Number ONE tracked entity from its item's `itemSerialSequence`, if it has no
 * number yet. Returns the assigned serial, or null when nothing was assigned:
 * the entity is already numbered, has no item, or its item has no sequence.
 *
 * Every call site is a "first touch" hook. It does not read the serial number
 * timing: under `production` it is how a unit gets its number, and under the
 * other timings it numbers only a unit left unnumbered (a job created under
 * `production` before its timing changed). Every call site must be safe to
 * fire repeatedly on the same unit:
 * hence the `readableId IS NULL` guard and the row lock. Two operators touching
 * the same unit at once serialize on the entity row, and the second sees the
 * first one's number instead of reserving and burning another. Runs inside the
 * caller's transaction, so the counter reservation commits or rolls back with
 * the write that prompted it.
 *
 * `onlyIfSingleUnit` leaves an entity holding more than one unit unnumbered.
 * A caller that does not cut the entity to one unit in the same transaction
 * passes it, or a job's unsplit seed would carry one serial for every unit.
 *
 * `jobMakeMethodId` numbers the entity only when it is a unit of that make
 * method. A caller whose entity id comes from a request passes it, so an id
 * from another job cannot draw a number.
 */
export async function assignSerialNumberIfMissing(
  trx: Transaction<KyselyDatabase>,
  args: {
    trackedEntityId: string;
    companyId: string;
    onlyIfSingleUnit?: boolean;
    jobMakeMethodId?: string;
  }
): Promise<string | null> {
  const entity = await trx
    .selectFrom("trackedEntity")
    .select(["id", "itemId", "readableId", "attributes", "quantity"])
    .where("id", "=", args.trackedEntityId)
    .where("companyId", "=", args.companyId)
    .forUpdate()
    .executeTakeFirst();

  if (!entity || entity.readableId || !entity.itemId) return null;
  if (args.onlyIfSingleUnit && Number(entity.quantity) !== 1) return null;
  const attributes = entity.attributes as Record<string, unknown> | null;
  if (
    args.jobMakeMethodId &&
    attributes?.["Job Make Method"] !== args.jobMakeMethodId
  ) {
    return null;
  }

  const [readableId] = await getNextSerialNumbers(trx, {
    itemId: entity.itemId,
    companyId: args.companyId,
    count: 1,
    ...(await getJobLocation(trx, attributes?.Job, args.companyId))
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
 * The serial number for a unit spawned after a job's units were numbered (a
 * serial completion's next unit, a scrap's replacement): the next number of
 * the item's sequence, with the job's location for %{location}. Null under the
 * `production` timing, where the unit is numbered at its first touch, and for
 * an item with no sequence. Runs in the caller's transaction, so the
 * reservation commits or rolls back with the spawn.
 */
export async function getSpawnSerialNumber(
  trx: Transaction<KyselyDatabase>,
  args: { itemId: string; companyId: string; jobId: string | null | undefined }
): Promise<string | null> {
  const timing = await getSerialNumberTiming(trx, args.companyId, args.itemId);
  if (timing === "production") return null;
  const [serial] = await getNextSerialNumbers(trx, {
    itemId: args.itemId,
    companyId: args.companyId,
    count: 1,
    ...(await getJobLocation(trx, args.jobId, args.companyId))
  });
  return serial ?? null;
}

/**
 * The %{location} context for a job's unit: the location of its job. No job
 * interpolates the token to nothing, as it would at job creation for a job with
 * no location.
 */
async function getJobLocation(
  trx: Transaction<KyselyDatabase>,
  jobId: unknown,
  companyId: string
): Promise<{ locationCode: string | null; locationName: string | null }> {
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
