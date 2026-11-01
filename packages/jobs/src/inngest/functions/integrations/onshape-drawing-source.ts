// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { selectInBatches } from "@carbon/ee/onshape";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";

// Which drawing PDFs an item last got from an assembly push, so an unchanged
// drawing is not exported again. One mapping row per item (the table allows one
// per entity type, entity and integration): `metadata.drawings` maps a drawing
// element id to the source key of its last export.

export const DRAWING_SOURCE_ENTITY_TYPE = "drawingSource";

type CarbonClient = SupabaseClient<Database>;

/**
 * Names a drawing export by what it was made from: the drawing at its version
 * or microversion, and the row it shows at its version or microversion (a
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

/** Per item id, the source key of each drawing it last got. */
export async function loadDrawingSources(
  carbon: CarbonClient,
  companyId: string,
  itemIds: string[]
): Promise<Record<string, Record<string, string>>> {
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
  const out: Record<string, Record<string, string>> = {};
  for (const row of rows.data ?? []) {
    out[row.entityId] = drawingKeysOf(row.metadata);
  }
  return out;
}

export function drawingKeysOf(metadata: unknown): Record<string, string> {
  const drawings = (metadata as { drawings?: unknown } | null)?.drawings;
  if (!drawings || typeof drawings !== "object" || Array.isArray(drawings)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [elementId, key] of Object.entries(drawings)) {
    if (typeof key === "string") out[elementId] = key;
  }
  return out;
}

/**
 * Records one drawing's export on its item. One statement merges the drawing
 * into `metadata.drawings`, so two drawings of one item recorded at once both
 * stay.
 */
export async function recordDrawingSource(
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    itemId: string;
    drawingElementId: string;
    sourceKey: string;
  }
): Promise<void> {
  const entry = sql`jsonb_build_object(${input.drawingElementId}::text, ${input.sourceKey}::text)`;
  const now = datetime.timestamp();
  await db
    .insertInto("externalIntegrationMapping")
    .values({
      entityType: DRAWING_SOURCE_ENTITY_TYPE,
      entityId: input.itemId,
      integration: ONSHAPE_V2_INTEGRATION_ID,
      externalId: null,
      allowDuplicateExternalId: true,
      metadata: sql`jsonb_build_object('drawings', ${entry})`,
      companyId: input.companyId,
      createdBy: input.userId,
      updatedAt: now
    })
    .onConflict((oc) =>
      oc
        .columns(["entityType", "entityId", "integration", "companyId"])
        .doUpdateSet({
          metadata: sql`jsonb_set(coalesce("externalIntegrationMapping"."metadata", '{}'::jsonb), '{drawings}', coalesce("externalIntegrationMapping"."metadata"->'drawings', '{}'::jsonb) || ${entry})`,
          updatedAt: now
        })
    )
    .execute();
}
