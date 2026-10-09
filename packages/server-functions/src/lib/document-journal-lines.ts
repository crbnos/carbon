// The journal lines one document's chain owns: a void builder, the GR/IR
// lookup and the accrual reader follow them. Only lines whose journal has one
// of DOCUMENT_JOURNAL_STATUSES count (Provisional, Posted, Reversed), so a
// Superseded journal from before the accounting cutover is never read again
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 2).

import type { Database } from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely, Selectable, Transaction } from "kysely";

type DocumentType = Database["public"]["Enums"]["journalLineDocumentType"];

/** What narrows the lines. Every field set must match; an empty list matches
 *  nothing. */
export type DocumentJournalLineFilter = {
  documentId?: string;
  documentType?: DocumentType | readonly DocumentType[];
  documentLineReference?: readonly string[];
  journalId?: readonly string[];
  journalLineReference?: readonly string[];
  accrual?: boolean;
};

export async function documentJournalLines(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string,
  filter: DocumentJournalLineFilter
): Promise<Selectable<KyselyDatabase["journalLine"]>[]> {
  const lists = [
    filter.documentLineReference,
    filter.journalId,
    filter.journalLineReference
  ];
  if (lists.some((list) => list !== undefined && list.length === 0)) {
    return [];
  }
  let query = db
    .selectFrom("journalLine")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "journalLine.journalId")
        .onRef("journal.companyId", "=", "journalLine.companyId")
    )
    .selectAll("journalLine")
    .where("journalLine.companyId", "=", companyId)
    .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES]);
  if (filter.documentId !== undefined) {
    query = query.where("journalLine.documentId", "=", filter.documentId);
  }
  if (typeof filter.documentType === "string") {
    query = query.where("journalLine.documentType", "=", filter.documentType);
  } else if (filter.documentType !== undefined) {
    query = query.where("journalLine.documentType", "in", [
      ...filter.documentType
    ]);
  }
  if (filter.documentLineReference !== undefined) {
    query = query.where("journalLine.documentLineReference", "in", [
      ...filter.documentLineReference
    ]);
  }
  if (filter.journalId !== undefined) {
    query = query.where("journalLine.journalId", "in", [...filter.journalId]);
  }
  if (filter.journalLineReference !== undefined) {
    query = query.where("journalLine.journalLineReference", "in", [
      ...filter.journalLineReference
    ]);
  }
  if (filter.accrual !== undefined) {
    query = query.where("journalLine.accrual", "=", filter.accrual);
  }
  return query.execute();
}
