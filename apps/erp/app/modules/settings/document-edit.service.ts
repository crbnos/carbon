// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import {
  type Kysely,
  type KyselyDatabase,
  withTransaction
} from "@carbon/database/client";
import type {
  DocumentEdit,
  DocumentEditType,
  ValueEdits
} from "@carbon/documents/template";
import {
  isEmptyDocumentEdit,
  rewriteValueEditRowKeys
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { DOCUMENT_EDIT_RECORDS } from "./settings.utils";

const jsonb = (value: unknown) => sql<Json>`${JSON.stringify(value)}::jsonb`;

/**
 * The record a document prints, for the "Edit document" modal: its readable
 * number, whether it is locked, and the notes its Notes block prints. Read with
 * the caller's client, so a record the caller cannot see is not found.
 */
export async function getDocumentEditRecord(
  client: SupabaseClient<Database>,
  companyId: string,
  documentType: DocumentEditType,
  documentId: string
) {
  const record = DOCUMENT_EDIT_RECORDS[documentType];
  const { data, error } = await client
    .from(record.table as "purchaseOrder")
    .select(
      ["status", record.readableId, record.notesColumn]
        .filter(Boolean)
        .join(", ")
    )
    .eq("id", documentId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (error || !data) return { data: null, error };
  const row = data as unknown as Record<string, unknown>;
  return {
    data: {
      label: String(row[record.readableId] ?? documentId),
      locked: record.isLocked(row.status as string | null),
      notes: record.notesColumn
        ? ((row[record.notesColumn] as JSONContent | null) ?? null)
        : null
    },
    error: null
  };
}

/**
 * Save one document's edits and, when given, its notes, together. An empty edit
 * deletes the row, so the document follows the template again. Writes nothing and
 * says why when the record is locked or gone.
 */
export async function saveDocumentEditRow(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    documentType: DocumentEditType;
    documentId: string;
    edit: DocumentEdit;
    notes?: JSONContent | null;
    userId: string;
  }
) {
  const { companyId, documentType, documentId, edit, userId } = args;
  const now = datetime.timestamp();
  const record = DOCUMENT_EDIT_RECORDS[documentType];

  return withTransaction(db, async (trx) => {
    // Lock the record row while the edit is written: a finalize that runs at the
    // same time waits for this save, or this save sees the record locked.
    const current = await trx
      .selectFrom(record.table as "purchaseOrder")
      .select("status")
      .where("id", "=", documentId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!current) return "notFound" as const;
    if (record.isLocked(current.status)) return "locked" as const;

    if (isEmptyDocumentEdit(edit)) {
      await trx
        .deleteFrom("documentEdit")
        .where("companyId", "=", companyId)
        .where("documentType", "=", documentType)
        .where("documentId", "=", documentId)
        .execute();
    } else {
      await trx
        .insertInto("documentEdit")
        .values({
          companyId,
          documentType,
          documentId,
          blocks: jsonb(edit.blocks),
          settings: jsonb(edit.settings),
          createdBy: userId
        })
        .onConflict((oc) =>
          oc.columns(["companyId", "documentType", "documentId"]).doUpdateSet({
            blocks: jsonb(edit.blocks),
            settings: jsonb(edit.settings),
            updatedBy: userId,
            updatedAt: now
          })
        )
        .execute();
    }

    if (args.notes !== undefined && record.notesColumn) {
      // The record's own notes column: the same text its page edits.
      await trx
        .updateTable(record.table as "purchaseOrder")
        .set({
          [record.notesColumn]: jsonb(args.notes ?? {}),
          updatedBy: userId,
          updatedAt: now
        } as never)
        .where("id", "=", documentId)
        .where("companyId", "=", companyId)
        .execute();
    }
    return "saved" as const;
  });
}

/**
 * Give a new copy of a document the same edits (a quote revision prints like
 * the quote it revises). Nothing happens when the source has none.
 */
export async function copyDocumentEdit(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    documentType: DocumentEditType;
    fromId: string;
    toId: string;
    userId: string;
    /** The copy's id for each of the record's row ids. */
    rowIds: ReadonlyMap<string, string>;
  }
) {
  const source = await db
    .selectFrom("documentEdit")
    .select(["blocks", "settings"])
    .where("companyId", "=", args.companyId)
    .where("documentType", "=", args.documentType)
    .where("documentId", "=", args.fromId)
    .executeTakeFirst();
  if (!source) return;

  const settings = (source.settings ?? {}) as { valueEdits?: ValueEdits };
  await db
    .insertInto("documentEdit")
    .values({
      companyId: args.companyId,
      documentType: args.documentType,
      documentId: args.toId,
      blocks: jsonb(source.blocks),
      settings: jsonb(
        settings.valueEdits
          ? {
              ...settings,
              valueEdits: rewriteValueEditRowKeys(settings.valueEdits, (id) =>
                args.rowIds.get(id)
              )
            }
          : settings
      ),
      createdBy: args.userId
    })
    .onConflict((oc) =>
      oc.columns(["companyId", "documentType", "documentId"]).doNothing()
    )
    .execute();
}
