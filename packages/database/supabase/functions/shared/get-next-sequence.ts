import { Transaction } from "https://esm.sh/kysely@0.26.3";
import { DB } from "../lib/database.ts";
import { interpolateSequenceDate } from "../lib/utils.ts";

export async function getNextSequence(
  trx: Transaction<DB>,
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
  currentSequence: string,
  companyId: string
) {
  // Check if the current sequence already has a revision number (hyphen followed by two numbers)
  const revisionRegex = /-(\d{2})$/;
  const match = currentSequence.match(revisionRegex);

  // Get the base sequence without revision number if it exists
  const baseSequence = match
    ? currentSequence.replace(revisionRegex, "")
    : currentSequence;

  const relatedSequences = await trx
    // @ts-ignore - we're using variables for table names
    .selectFrom(tableName)
    // @ts-ignore - we're using variables for column names
    .select([sequenceColumn])
    // @ts-ignore - we're using variables for column names
    .where(sequenceColumn, "like", `${baseSequence}-%`)
    .where("companyId", "=", companyId)
    // @ts-ignore - we're using variables for column names
    .orderBy(sequenceColumn, "desc")
    .execute();

  if (relatedSequences.length === 0) {
    return `${baseSequence}-01`;
  }

  // Get the highest revision number from related sequences
  const highestRevision = relatedSequences.reduce((highest, seq) => {
    const revMatch = seq[sequenceColumn as keyof typeof seq]
      ?.toString()
      .match(revisionRegex);
    if (revMatch) {
      const revNum = parseInt(revMatch[1], 10);
      return revNum > highest ? revNum : highest;
    }
    return highest;
  }, 0);

  // Increment the highest revision number
  const nextRevision = highestRevision + 1;
  return `${baseSequence}-${nextRevision.toString().padStart(2, "0")}`;
}
