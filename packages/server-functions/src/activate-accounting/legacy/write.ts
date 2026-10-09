// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Writes the journals the enable builds for legacy documents
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a): Provisional, with
// no period, so the later steps of the enable re-cost, period, re-point and
// promote them like every other Provisional journal.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { getNextSequences } from "@carbon/database/sequence";
import { datetime } from "@carbon/utils";
import { sql } from "kysely";

type Enums = Database["public"]["Enums"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];

export type DimensionEntityType = Enums["dimensionEntityType"];

/** One line, as the document's posting writes it, and its dimension values. */
export type LegacyJournalLine = Omit<
  JournalLineInsert,
  "journalId" | "companyId" | "createdBy"
> & {
  dimensions: Partial<Record<DimensionEntityType, string | null>>;
  /** Values by dimension id, as a posting that resolves its own dimensions
   *  writes them. One wins over a `dimensions` value of the same dimension. */
  dimensionValues?: { dimensionId: string; valueId: string }[];
};

export type LegacyJournal = {
  description: string;
  postingDate: string;
  sourceType: Enums["journalEntrySourceType"];
  lines: LegacyJournalLine[];
};

/** A legacy journal and the document whose `journalId` gets its id. */
export type LegacyDocumentJournal = LegacyJournal & {
  documentId: string;
  /** A reimbursement's payable account, set on a row that has none. */
  payableAccountId?: string;
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

/** The rows by key, each list in the order given. */
export function groupBy<T>(
  rows: T[],
  key: (row: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
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

/** Items by id, with what the movement journals read. */
export async function readItems(
  trx: KyselyTx,
  companyId: string,
  itemIds: Iterable<string | null | undefined>
) {
  const rows = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("item")
      .select([
        "id",
        "itemTrackingType",
        "replenishmentSystem",
        "readableIdWithRevision"
      ])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/** Each item's posting group (the ItemPostingGroup dimension), by item id. */
export async function readPostingGroups(
  trx: KyselyTx,
  companyId: string,
  itemIds: Iterable<string | null | undefined>
) {
  const rows = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "itemPostingGroupId"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  return new Map(rows.map((row) => [row.itemId, row.itemPostingGroupId]));
}

/**
 * Inserts the journals, their lines and the lines' dimensions in a few
 * statements. A journal with no lines is skipped, as a posting skips a
 * zero-value document. The journal entry numbers are allocated in order.
 * Returns the id of each journal, in the order given (null when skipped).
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
): Promise<(string | null)[]> {
  const writable = journals.filter((journal) => journal.lines.length > 0);
  if (writable.length === 0) return journals.map(() => null);

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
    return journal.lines.map(
      ({ dimensions: values, dimensionValues, ...line }) => ({
        insert: { ...line, journalId, companyId, createdBy: userId },
        values,
        dimensionValues: dimensionValues ?? []
      })
    );
  });
  for (const rows of chunks(lines)) {
    // Returned in insert order, as every posting reads them back.
    const inserted = await trx
      .insertInto("journalLine")
      .values(rows.map((row) => row.insert))
      .returning("id")
      .execute();
    const dimensionInserts = inserted.flatMap((line, index) => {
      const row = rows[index]!;
      const valueByDimension = new Map<string, string>();
      for (const [entityType, valueId] of Object.entries(row.values)) {
        const dimensionId = dimensionIdByEntity.get(
          entityType as DimensionEntityType
        );
        if (dimensionId && valueId) valueByDimension.set(dimensionId, valueId);
      }
      for (const { dimensionId, valueId } of row.dimensionValues) {
        valueByDimension.set(dimensionId, valueId);
      }
      return [...valueByDimension].map(([dimensionId, valueId]) => ({
        journalLineId: line.id,
        dimensionId,
        valueId,
        companyId
      }));
    });
    for (const dimensionRows of chunks(dimensionInserts)) {
      await trx
        .insertInto("journalLineDimension")
        .values(dimensionRows)
        .execute();
    }
  }
  const idByJournal = new Map(
    writable.map((journal, index) => [
      journal,
      journalIdByEntry.get(entryIds[index]!)!
    ])
  );
  return journals.map((journal) => idByJournal.get(journal) ?? null);
}

/** A document whose posting stores the journal it wrote. */
export type JournalDocumentTable =
  | "payment"
  | "memo"
  | "charge"
  | "reimbursement";

/**
 * Sets each document's `journalId` to the journal the enable wrote for it, as
 * its posting does, so a later void reverses that journal. A reimbursement
 * with no payable account also gets the one its journal credits. One
 * statement per chunk.
 */
export async function attachJournalIds(
  trx: KyselyTx,
  {
    table,
    companyId,
    userId,
    rows
  }: {
    table: JournalDocumentTable;
    companyId: string;
    userId: string;
    rows: { id: string; journalId: string | null; payableAccountId?: string }[];
  }
): Promise<void> {
  const attached = rows.filter((row) => row.journalId !== null);
  const updatedAt = datetime.timestamp();
  for (const chunk of chunks(attached)) {
    const values = sql`jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
      AS v("id" text, "journalId" text, "payableAccountId" text)`;
    if (table === "reimbursement") {
      await sql`UPDATE "reimbursement" AS d
        SET "journalId" = v."journalId",
          "payableAccountId" = COALESCE(d."payableAccountId", v."payableAccountId"),
          "updatedAt" = ${updatedAt}, "updatedBy" = ${userId}
        FROM ${values}
        WHERE d."id" = v."id" AND d."companyId" = ${companyId}`.execute(trx);
    } else {
      await sql`UPDATE ${sql.table(table)} AS d
        SET "journalId" = v."journalId",
          "updatedAt" = ${updatedAt}, "updatedBy" = ${userId}
        FROM ${values}
        WHERE d."id" = v."id" AND d."companyId" = ${companyId}`.execute(trx);
    }
  }
}
