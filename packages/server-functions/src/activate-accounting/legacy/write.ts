// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Writes the journals the enable builds for legacy documents
// (.ai/specs/2026-10-08-accounting-cutover.md section 5a): Provisional, with
// no period, so the later steps of the enable re-cost, period, re-point and
// promote them like every other Provisional journal.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { getNextSequences } from "@carbon/database/sequence";
import { datetime } from "@carbon/utils";

type Enums = Database["public"]["Enums"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

export type DimensionEntityType = Enums["dimensionEntityType"];

/** One line, as the document's posting writes it, and its dimension values. */
export type LegacyJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: Partial<Record<DimensionEntityType, string | null>>;
};

export type LegacyJournal = {
  description: string;
  postingDate: string;
  sourceType: Enums["journalEntrySourceType"];
  lines: LegacyJournalLine[];
};

/** Rows per statement, well inside Postgres's 65,535 bind parameters. */
const CHUNK_SIZE = 1000;

export function chunks<T>(rows: T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    result.push(rows.slice(start, start + CHUNK_SIZE));
  }
  return result;
}

/** Runs `read` once per chunk of the distinct ids and concatenates the rows. */
export async function readByIds<T>(
  ids: Iterable<string | null | undefined>,
  read: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const unique = [
    ...new Set([...ids].filter((id): id is string => Boolean(id)))
  ];
  const rows: T[] = [];
  for (const chunk of chunks(unique)) rows.push(...(await read(chunk)));
  return rows;
}

/**
 * Inserts the journals, their lines and the lines' dimensions in a few
 * statements. A journal with no lines is skipped, as a posting skips a
 * zero-value document. The journal entry numbers are allocated in order.
 */
export async function insertProvisionalJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    journals
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    journals: LegacyJournal[];
  }
): Promise<void> {
  const writable = journals.filter((journal) => journal.lines.length > 0);
  if (writable.length === 0) return;

  const entryIds = await getNextSequences(
    trx,
    "journalEntry",
    companyId,
    writable.length
  );
  const postedAt = datetime.timestamp();
  const journalIdByEntry = new Map<string, string>();
  for (const rows of chunks(
    writable.map((journal, index) => ({ journal, entryId: entryIds[index]! }))
  )) {
    const inserted = await trx
      .insertInto("journal")
      .values(
        rows.map(({ journal, entryId }) => ({
          journalEntryId: entryId,
          accountingPeriodId: null,
          description: journal.description,
          postingDate: journal.postingDate,
          sourceType: journal.sourceType,
          status: "Provisional" as const,
          postedAt,
          postedBy: userId,
          companyId,
          createdBy: userId
        }))
      )
      .returning(["id", "journalEntryId"])
      .execute();
    for (const row of inserted)
      journalIdByEntry.set(row.journalEntryId, row.id);
  }

  const dimensions = await trx
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", companyGroupId)
    .where("active", "=", true)
    .execute();
  const dimensionIdByEntity = new Map(
    dimensions.map((dimension) => [dimension.entityType, dimension.id])
  );

  const lines = writable.flatMap((journal, index) => {
    const journalId = journalIdByEntry.get(entryIds[index]!)!;
    return journal.lines.map(({ dimensions: values, ...line }) => ({
      insert: { ...line, journalId, companyId, createdBy: userId },
      values
    }));
  });
  for (const rows of chunks(lines)) {
    // Returned in insert order, as every posting reads them back.
    const inserted = await trx
      .insertInto("journalLine")
      .values(rows.map((row) => row.insert))
      .returning("id")
      .execute();
    const dimensionInserts = inserted.flatMap((line, index) =>
      Object.entries(rows[index]!.values).flatMap(([entityType, valueId]) => {
        const dimensionId = dimensionIdByEntity.get(
          entityType as DimensionEntityType
        );
        return dimensionId && valueId
          ? [{ journalLineId: line.id, dimensionId, valueId, companyId }]
          : [];
      })
    );
    for (const dimensionRows of chunks(dimensionInserts)) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionRows)
        .execute();
    }
  }
}
