// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Document-number allocation lives in one place: duplicate implementations
// silently diverge and mint duplicate sequence IDs.
import { CalendarDate, getDayOfWeek, now } from "@internationalized/date";
import { sql, type Transaction } from "kysely";
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
// this — keep the two in sync.
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

// Serial-number segment interpolation: the date/week tokens above, plus the
// job-context %{location} token (location.code, falling back to location.name).
const interpolateSerialNumber = (
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
 * its configured `itemSerialSequence`. Returns `[]` when the item has no sequence
 * (so callers leave `readableId` null, exactly as before). Runs inside the
 * caller's Kysely transaction, so the counter reservation commits — or rolls back
 * — together with the write that consumes the numbers.
 *
 * Each number interpolates the date/week tokens (%{yyyy} %{yy} %{mm} %{ww} %{dd})
 * plus %{location} (location.code, falling back to the location name).
 *
 * Used by both `assign-serial-numbers` (the N units that exist at job creation)
 * and `issue` (a unit spawned lazily on completion, e.g. after the job quantity
 * was increased), so serials follow the pattern regardless of when the entity is
 * created.
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

  const reserved = await trx
    .updateTable("itemSerialSequence")
    .set({
      next: sql<number>`"next" + ${args.count} * "step"`,
      updatedBy: "system",
      updatedAt: new Date().toISOString()
    })
    .where("itemId", "=", args.itemId)
    .where("companyId", "=", args.companyId)
    .returning(["next", "prefix", "suffix", "size", "step"])
    .executeTakeFirst();

  if (!reserved) return []; // item has no serial sequence configured

  const size = reserved.size ?? 5;
  const step = reserved.step ?? 1;
  const startNext = reserved.next - args.count * step;
  const context = {
    locationCode: args.locationCode,
    locationName: args.locationName,
    timezone: await getCompanyTimeZone(trx, args.companyId)
  };

  const serials: string[] = [];
  for (let i = 1; i <= args.count; i++) {
    const value = startNext + i * step;
    const counter = value.toString().padStart(size, "0");
    const prefix = interpolateSerialNumber(reserved.prefix, context);
    const suffix = interpolateSerialNumber(reserved.suffix, context);
    serials.push(`${prefix}${counter}${suffix}`);
  }
  return serials;
}
