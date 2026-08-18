// Finding items the LEGACY Onshape pipeline touched that v2 cannot see.
//
// The two pipelines join to Carbon differently. Legacy stamps an item with
// `integration = "onshapeData"` (externalId = readableIdWithRevision, the raw
// BOM row in metadata) and, for a BOM-import root, `integration = "onshape"`
// (picker state, externalId NULL). v2 resolves ONLY through
// `integration = "onshapeElement"`. So an item the legacy pipeline managed is
// invisible to v2 until someone links it — and nothing in the product says so.
//
// This is the count behind that warning.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ONSHAPE_ELEMENT_INTEGRATION,
  ONSHAPE_MAPPING_ENTITY_TYPE
} from "./mapping";

/** The two `integration` values the legacy pipeline stamps on an ITEM. */
export const LEGACY_ONSHAPE_ITEM_INTEGRATIONS = [
  "onshapeData",
  "onshape"
] as const;

export type UnlinkedLegacyItem = {
  itemId: string;
  readableIdWithRevision: string;
  name: string;
};

/**
 * Items the legacy pipeline knows and v2 does not.
 *
 * Three details each earn their place:
 *
 *  - `entityType = "item"` is essential. `integration = "onshape"` is
 *    OVERLOADED: the same value marks the release-import claim row, whose
 *    entityType is "onshapeRelease" and whose entityId is a releaseId. Without
 *    the filter, release markers inflate an item count.
 *  - One item can legitimately carry BOTH legacy rows — the always-enforced
 *    UNIQUE is (entityType, entityId, integration, companyId), i.e. one row per
 *    integration — so the ids must be de-duplicated.
 *  - The result is filtered against real items. No FK ties
 *    externalIntegrationMapping to item, so a deleted item leaves its mapping
 *    behind forever, and counting it would report work nobody can do.
 */
export async function findUnlinkedLegacyOnshapeItems(
  client: SupabaseClient<Database>,
  args: { companyId: string; limit?: number }
): Promise<{ count: number; items: UnlinkedLegacyItem[] }> {
  // PAGED. PostgREST caps an unbounded select at 1000 rows and says nothing
  // about it, so a company with more legacy mappings than that would be told a
  // migration is smaller than it is — and the warning's whole job is to state
  // the size of the work.
  const legacyRows: Array<{ entityId: string }> = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const page = await client
      .from("externalIntegrationMapping")
      .select("entityId")
      .eq("companyId", args.companyId)
      .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
      .in("integration", [...LEGACY_ONSHAPE_ITEM_INTEGRATIONS])
      .order("entityId", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (page.error) {
      throw new Error(
        `Failed to read legacy Onshape mappings: ${page.error.message}`
      );
    }
    const rows = page.data ?? [];
    legacyRows.push(...rows);
    if (rows.length < PAGE) break;
  }

  const legacyItemIds = Array.from(
    new Set(legacyRows.map((row) => row.entityId))
  );
  if (legacyItemIds.length === 0) return { count: 0, items: [] };

  const linked = new Set<string>();
  const CHUNK = 200;
  for (let index = 0; index < legacyItemIds.length; index += CHUNK) {
    const chunk = legacyItemIds.slice(index, index + CHUNK);
    const v2 = await client
      .from("externalIntegrationMapping")
      .select("entityId")
      .eq("companyId", args.companyId)
      .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
      .eq("integration", ONSHAPE_ELEMENT_INTEGRATION)
      .in("entityId", chunk);

    if (v2.error) {
      throw new Error(
        `Failed to read Onshape element mappings: ${v2.error.message}`
      );
    }
    for (const row of v2.data ?? []) linked.add(row.entityId);
  }

  const unlinkedIds = legacyItemIds.filter((id) => !linked.has(id));
  if (unlinkedIds.length === 0) return { count: 0, items: [] };

  // Resolve against `item` so rows orphaned by a deleted item drop out, and so
  // the warning can name what needs doing rather than showing ids.
  const items: UnlinkedLegacyItem[] = [];
  for (let index = 0; index < unlinkedIds.length; index += CHUNK) {
    const chunk = unlinkedIds.slice(index, index + CHUNK);
    const rows = await client
      .from("item")
      .select("id, readableIdWithRevision, name")
      .eq("companyId", args.companyId)
      .in("id", chunk);

    if (rows.error) {
      throw new Error(`Failed to read items: ${rows.error.message}`);
    }
    for (const row of rows.data ?? []) {
      items.push({
        itemId: row.id,
        readableIdWithRevision: row.readableIdWithRevision ?? row.id,
        name: row.name ?? ""
      });
    }
  }

  items.sort((a, b) =>
    a.readableIdWithRevision.localeCompare(b.readableIdWithRevision)
  );

  return {
    count: items.length,
    items: args.limit ? items.slice(0, args.limit) : items
  };
}
