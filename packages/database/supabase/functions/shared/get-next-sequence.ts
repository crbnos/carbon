import { sql, Transaction } from "kysely";
import { DB } from "../lib/database.ts";
import { interpolateSequenceDate } from "../lib/utils.ts";

export async function getNextSequence(
  trx: Transaction<DB>,
  tableName: string,
  companyId: string
) {
  // Atomic allocation: a single UPDATE...RETURNING. The ordinary row lock this
  // UPDATE takes is the serialization point — concurrent allocators for the same
  // company+table queue behind it instead of reading the same "next" and both
  // writing it (the old SELECT-then-UPDATE duplicate race is gone by
  // construction, in one round trip). Running on the caller's transaction means a
  // rollback reverts the increment together with the document, so a failed post
  // leaves no gap. "firstUsedAt" is stamped so the sequence-immutability trigger
  // can freeze legal sequences after first use.
  const result = await sql<{
    prefix: string | null;
    suffix: string | null;
    next: number;
    size: number;
  }>`
    UPDATE "sequence"
       SET "next" = "next" + "step",
           "firstUsedAt" = COALESCE("firstUsedAt", NOW()),
           "updatedAt" = NOW(),
           "updatedBy" = 'system'
     WHERE "table" = ${tableName}
       AND "companyId" = ${companyId}
     RETURNING "prefix", "suffix", "next", "size"
  `.execute(trx);

  const row = result.rows[0];
  if (!row) {
    throw new Error(
      `Sequence not found for table ${tableName} and company ${companyId}`
    );
  }

  const { prefix, suffix, next, size } = row;
  if (!Number.isInteger(size)) throw new Error("Size is not an integer");

  // "next" is the already-incremented value; format identically to before so
  // issued numbers stay byte-for-byte stable.
  const nextSequence = next.toString().padStart(size, "0");
  const derivedPrefix = interpolateSequenceDate(prefix);
  const derivedSuffix = interpolateSequenceDate(suffix);

  return `${derivedPrefix}${nextSequence}${derivedSuffix}`;
}

export async function getNextRevisionSequence(
  trx: Transaction<DB>,
  tableName: string,
  sequenceColumn: string,
  sequenceValue: string,
  companyId: string
) {
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
