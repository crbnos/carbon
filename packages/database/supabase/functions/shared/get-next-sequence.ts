import { sql, Transaction } from "kysely";
// Type-only import from postgres/index.ts (not lib/database.ts) keeps the
// Deno-only driver out of the graph so this file is also importable from the
// node-side @carbon/database/quality engine.
import type { KyselyDatabase as DB } from "../lib/postgres/index.ts";
import { interpolateSequenceDate } from "../lib/utils.ts";

// Sequence date tokens (%{yyyy}, %{ww}, …) roll over at the COMPANY's midnight —
// document numbering is ledger-scoped. Inline query (not lib/datetime.ts) so
// this file stays importable from Node.
export async function getSequenceTimeZone(
  trx: Transaction<DB>,
  companyId: string
): Promise<string> {
  const row = await trx
    .selectFrom("company")
    .select("timezone")
    .where("id", "=", companyId)
    .executeTakeFirst();
  return row?.timezone ?? "UTC";
}

export async function getNextSequence(
  trx: Transaction<DB>,
  tableName: string,
  companyId: string
) {
  // Atomic increment: the UPDATE takes the row lock before reading, so two
  // concurrent transactions can't both read the same "next" and return the
  // same sequence number.
  const sequence = await trx
    .updateTable("sequence")
    .set({
      next: sql<number>`"next" + "step"`,
      updatedBy: "system",
    })
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .returning(["next", "prefix", "suffix", "size"])
    .executeTakeFirstOrThrow();

  const { prefix, suffix, next, size } = sequence;
  if (!Number.isInteger(next)) throw new Error("Next is not an integer");
  if (!Number.isInteger(size)) throw new Error("Size is not an integer");

  const nextSequence = next!.toString().padStart(size!, "0");
  const timezone = await getSequenceTimeZone(trx, companyId);
  const derivedPrefix = interpolateSequenceDate(prefix, timezone);
  const derivedSuffix = interpolateSequenceDate(suffix, timezone);

  return `${derivedPrefix}${nextSequence}${derivedSuffix}`;
}

export async function getNextRevisionSequence(
  trx: Transaction<DB>,
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
