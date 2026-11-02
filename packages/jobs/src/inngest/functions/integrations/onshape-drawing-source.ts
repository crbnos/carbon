// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { selectInBatches } from "@carbon/ee/onshape";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { itemDocumentPath } from "./onshape-source-keys";

// Which drawing PDFs an item last got from a push, so an unchanged drawing is
// not exported again, and under which file name, so a renamed drawing's PDF
// is renamed rather than left beside the new one. One mapping row per item
// (the table allows one per entity type, entity and integration):
// `metadata.drawings` maps a drawing element id to its `DrawingFileRecord`.

export const DRAWING_SOURCE_ENTITY_TYPE = "drawingSource";

const log = getLogger("jobs", "onshape-drawing-source");

type CarbonClient = SupabaseClient<Database>;

/**
 * Names a drawing export by what it was made from: the drawing at its version
 * or microversion, and the row it shows at its version or source state (a
 * drawing's own microversion does not change when its part does). Null when
 * either state is unknown: the drawing then exports every time.
 */
export function drawingSourceKey(input: {
  drawingElementId: string;
  drawingState: string | null | undefined;
  targetState: string | null | undefined;
}): string | null {
  if (!input.drawingState || !input.targetState) return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        "drawing-source-v1",
        input.drawingElementId,
        input.drawingState,
        input.targetState
      ])
    )
    .digest("hex");
}

/**
 * What an item holds of one drawing. `fileName` is the PDF's name on the item;
 * `sourceKey` the state its last export was made from, null until one lands.
 * `tooLarge` marks a state whose PDF was past the size limit, so it is not
 * exported again until the drawing or its part changes.
 */
export type DrawingFileRecord = {
  sourceKey: string | null;
  fileName: string;
  tooLarge?: true;
};

export function drawingRecordsOf(
  metadata: unknown
): Record<string, DrawingFileRecord> {
  const drawings = (metadata as { drawings?: unknown } | null)?.drawings;
  if (!drawings || typeof drawings !== "object" || Array.isArray(drawings)) {
    return {};
  }
  const out: Record<string, DrawingFileRecord> = {};
  for (const [elementId, value] of Object.entries(drawings)) {
    const record = value as Partial<DrawingFileRecord> | null;
    if (!record || typeof record.fileName !== "string") continue;
    out[elementId] = {
      sourceKey: typeof record.sourceKey === "string" ? record.sourceKey : null,
      fileName: record.fileName,
      ...(record.tooLarge === true ? { tooLarge: true as const } : {})
    };
  }
  return out;
}

/** Per item id, what it holds of each drawing, by drawing element id. */
export async function loadDrawingSources(
  carbon: CarbonClient,
  companyId: string,
  itemIds: string[]
): Promise<Record<string, Record<string, DrawingFileRecord>>> {
  if (itemIds.length === 0) return {};
  const rows = await selectInBatches([...new Set(itemIds)], (batch) =>
    carbon
      .from("externalIntegrationMapping")
      .select("entityId, metadata")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", DRAWING_SOURCE_ENTITY_TYPE)
      .in("entityId", batch)
  );
  if (rows.error) {
    throw new Error(`drawing source lookup failed: ${rows.error.message}`);
  }
  const out: Record<string, Record<string, DrawingFileRecord>> = {};
  for (const row of rows.data ?? []) {
    out[row.entityId] = drawingRecordsOf(row.metadata);
  }
  return out;
}

/**
 * Writes drawing records, one statement for every item. Each drawing is merged
 * into the item's `metadata.drawings`, so its other drawings stay.
 */
export async function recordDrawingSources(
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    entries: Array<{
      itemId: string;
      drawingElementId: string;
      record: DrawingFileRecord;
    }>;
  }
): Promise<void> {
  if (input.entries.length === 0) return;
  // One row per item: an upsert cannot touch one row twice.
  const byItem = new Map<string, Record<string, DrawingFileRecord>>();
  for (const entry of input.entries) {
    byItem.set(entry.itemId, {
      ...byItem.get(entry.itemId),
      [entry.drawingElementId]: entry.record
    });
  }
  const now = datetime.timestamp();
  await db
    .insertInto("externalIntegrationMapping")
    .values(
      [...byItem].map(([itemId, drawings]) => ({
        entityType: DRAWING_SOURCE_ENTITY_TYPE,
        entityId: itemId,
        integration: ONSHAPE_V2_INTEGRATION_ID,
        externalId: null,
        allowDuplicateExternalId: true,
        metadata: sql`${JSON.stringify({ drawings })}::jsonb`,
        companyId: input.companyId,
        createdBy: input.userId,
        updatedAt: now
      }))
    )
    .onConflict((oc) =>
      oc
        .columns(["entityType", "entityId", "integration", "companyId"])
        .doUpdateSet({
          metadata: sql`jsonb_set(coalesce("externalIntegrationMapping"."metadata", '{}'::jsonb), '{drawings}', coalesce("externalIntegrationMapping"."metadata"->'drawings', '{}'::jsonb) || (excluded."metadata"->'drawings'))`,
          updatedAt: now
        })
    )
    .execute();
}

/**
 * Moves each renamed drawing's PDF to its new name, with its document row,
 * then writes every placement's record. A move that fails is logged and its
 * record left as it was, so the next push tries it again. Storage has no
 * batch move, so the moves run one by one; only renamed drawings have one.
 */
export async function placeDrawingFiles(
  carbon: CarbonClient,
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    placements: Array<{
      itemId: string;
      drawingElementId: string;
      from: string | null;
      record: DrawingFileRecord;
    }>;
  }
): Promise<{ moved: number; failed: number }> {
  const bucket = storage(carbon).company(input.companyId);
  const placed: typeof input.placements = [];
  const moves: Array<{ from: string; to: string; name: string }> = [];
  for (const placement of input.placements) {
    if (!placement.from) {
      placed.push(placement);
      continue;
    }
    const from = itemDocumentPath(
      input.companyId,
      placement.itemId,
      placement.from
    );
    const to = itemDocumentPath(
      input.companyId,
      placement.itemId,
      placement.record.fileName
    );
    const result = await bucket.move(from, to);
    // A retried step finds the file already moved.
    if (result.error && (await bucket.info(to)).error) {
      log.warn("Could not rename a drawing PDF", {
        companyId: input.companyId,
        from,
        to,
        error: result.error
      });
      continue;
    }
    placed.push(placement);
    moves.push({ from, to, name: placement.record.fileName });
  }
  if (moves.length > 0) {
    await sql`
      UPDATE "document" AS d
      SET "path" = v."to", "name" = v."name",
          "updatedBy" = ${input.userId}, "updatedAt" = ${datetime.timestamp()}
      FROM (VALUES ${sql.join(
        moves.map(
          (move) =>
            sql`(${move.from}::text, ${move.to}::text, ${move.name}::text)`
        )
      )}) AS v("from", "to", "name")
      WHERE d."companyId" = ${input.companyId} AND d."path" = v."from"
    `.execute(db);
  }
  await recordDrawingSources(db, {
    companyId: input.companyId,
    userId: input.userId,
    entries: placed.map((placement) => ({
      itemId: placement.itemId,
      drawingElementId: placement.drawingElementId,
      record: placement.record
    }))
  });
  return {
    moved: moves.length,
    failed: input.placements.length - placed.length
  };
}
