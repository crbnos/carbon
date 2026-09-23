import { sql, type Transaction } from "kysely";
import type { DB } from "../lib/database.ts";

/**
 * Allocate native journal-line ids before a bulk insert. Callers can then keep
 * related rows bound to the intended line without depending on PostgreSQL's
 * unspecified INSERT ... RETURNING row order.
 */
export async function allocateJournalLineIds(
  trx: Transaction<DB>,
  count: number,
): Promise<string[]> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Journal line id count must be a non-negative integer");
  }
  if (count === 0) return [];

  const allocated = await sql<{ id: string; position: number }>`
    SELECT id('jl') AS id, position::integer AS position
    FROM generate_series(1, ${count}) WITH ORDINALITY AS requested(_, position)
    ORDER BY position
  `.execute(trx);
  if (allocated.rows.length !== count) {
    throw new Error("Failed to allocate journal line ids");
  }
  return allocated.rows.map((row) => row.id);
}
