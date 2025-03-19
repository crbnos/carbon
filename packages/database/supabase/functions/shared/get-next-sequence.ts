import { Transaction } from "https://esm.sh/kysely@0.26.3";
import { DB } from "../lib/database.ts";
import { interpolateSequenceDate } from "../lib/utils.ts";

export async function getNextSequence(
  trx: Transaction<DB> | Kysely<DB>,
  tableName: string,
  companyId: string
) {
  // get current purchase invoice sequence number
  const sequence = await trx
    .selectFrom("sequence")
    .selectAll()
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .executeTakeFirstOrThrow();

  const { prefix, suffix, next, size, step } = sequence;
  if (!Number.isInteger(step)) throw new Error("Next is not an integer");
  if (!Number.isInteger(step)) throw new Error("Step is not an integer");
  if (!Number.isInteger(size)) throw new Error("Size is not an integer");

  const nextValue = next! + step!;
  const nextSequence = nextValue.toString().padStart(size!, "0");
  const derivedPrefix = interpolateSequenceDate(prefix);
  const derivedSuffix = interpolateSequenceDate(suffix);

  await trx
    .updateTable("sequence")
    .set({
      next: nextValue,
      updatedBy: "system",
    })
    .where("table", "=", tableName)
    .where("companyId", "=", companyId)
    .execute();

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
