import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanLine, PlanMethodRow, PlanOptions } from "../panel/plan";
import { selectInBatches } from "./batched-filter";

/**
 * Carbon reads the panel's plan and apply routes share. Every function here
 * takes the ids it needs in one call — the plan for an 11-line BOM must not
 * cost 11 round trips — and returns plain maps the pure builders in
 * `panel/plan.ts` consume.
 *
 * "One call" is bounded by the gateway, not by us: an `.in()` list rides in
 * the URL and the request line dies past 4 KB. Every list sized by the BOM
 * therefore goes through `selectInBatches`, which splits on encoded bytes —
 * a count would be wrong, since these ids range from 22 to 58 characters.
 */

type Client = SupabaseClient<Database>;

/** The company's units, for the unit-of-measure choice on a create. */
export async function loadPlanOptions(
  client: Client,
  companyId: string
): Promise<PlanOptions> {
  const units = await client
    .from("unitOfMeasure")
    .select("code, name")
    .eq("companyId", companyId)
    .order("name");
  return {
    unitsOfMeasure: (units.data ?? []).map((unit) => ({
      code: unit.code,
      name: unit.name
    }))
  };
}

/** The active make method per item id (activeMakeMethods view), one query. */
export async function loadActiveMakeMethods(
  client: Client,
  companyId: string,
  itemIds: string[]
): Promise<Map<string, PlanMethodRow>> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return new Map();
  const rows = await selectInBatches(ids, (batch) =>
    client
      .from("activeMakeMethods")
      .select("id, itemId, status")
      .eq("companyId", companyId)
      .in("itemId", batch)
  );
  const byItemId = new Map<string, PlanMethodRow>();
  for (const row of rows.data ?? []) {
    if (row.id && row.itemId) {
      byItemId.set(row.itemId, { id: row.id, status: row.status ?? "Draft" });
    }
  }
  return byItemId;
}

/**
 * An Onshape-owned line as it stands in Carbon right now. The last three are
 * the only columns a push is authoritative for, and they are carried so apply
 * can tell an unchanged line from a changed one and skip the write entirely —
 * an untouched re-push should cost no UPDATEs and leave no audit trail.
 */
export type MappedLineRow = {
  mappingId: string;
  lineId: string;
  itemId: string;
  quantity: number | null;
  order: number | null;
  materialMakeMethodId: string | null;
};

export type MethodLineOwnership = {
  /** Lines a previous Onshape push wrote, per method id. */
  mapped: Map<string, PlanLine[]>;
  /** Lines nothing pushed (manual), per method id. */
  manual: Map<string, PlanLine[]>;
  /**
   * The Onshape-owned rows apply reconciles against the plan, per method id.
   * `itemId` is what pairs an existing line with the write for the same
   * component, so the line can be UPDATED in place — a delete-and-reinsert
   * drops every Carbon-owned column on it (the operation link, scrap, tags,
   * kit, the line's own custom fields).
   */
  mappedRows: Map<string, MappedLineRow[]>;
};

/**
 * Which lines on each method are Onshape's and which are the user's. Line
 * provenance lives only in `externalIntegrationMapping` (entityType
 * `methodMaterial`, `metadata.makeMethodId`), so both sets come from joining
 * the method's lines to those rows — the mapping table is read with the
 * service role, as the pushes do.
 */
export async function loadMethodLineOwnership(
  client: Client,
  serviceRole: Client,
  companyId: string,
  methodIds: string[]
): Promise<MethodLineOwnership> {
  const ids = [...new Set(methodIds)];
  const result: MethodLineOwnership = {
    mapped: new Map(),
    manual: new Map(),
    mappedRows: new Map()
  };
  if (ids.length === 0) return result;

  const [lines, mappings] = await Promise.all([
    selectInBatches(ids, (batch) =>
      client
        .from("methodMaterial")
        .select(
          "id, makeMethodId, itemId, quantity, order, materialMakeMethodId"
        )
        .eq("companyId", companyId)
        .in("makeMethodId", batch)
    ),
    selectInBatches(ids, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("id, entityId, metadata")
        .eq("companyId", companyId)
        .eq("integration", "onshape")
        .eq("entityType", "methodMaterial")
        .in("metadata->>makeMethodId", batch)
    )
  ]);

  // A read that failed is not "no Onshape lines": treating it so would make
  // the apply rewrite a method without deleting the lines it already holds.
  if (lines.error || mappings.error) {
    throw new Error(
      `Failed to read the existing BOM lines: ${
        lines.error?.message ?? mappings.error?.message ?? "unknown error"
      }`
    );
  }
  const mappingByLineId = new Map(
    (mappings.data ?? []).map((mapping) => [mapping.entityId, mapping.id])
  );

  const itemIds = [
    ...new Set((lines.data ?? []).map((line) => line.itemId).filter(Boolean))
  ];
  const items = await selectInBatches(itemIds, (batch) =>
    client
      .from("item")
      .select("id, readableId")
      .eq("companyId", companyId)
      .in("id", batch)
  );
  const readableIdByItemId = new Map(
    (items.data ?? []).map((item) => [item.id, item.readableId])
  );

  for (const line of lines.data ?? []) {
    const methodId = line.makeMethodId;
    if (!methodId) continue;
    const planLine: PlanLine = {
      readableId: readableIdByItemId.get(line.itemId) ?? line.itemId,
      quantity: line.quantity
    };
    const mappingId = mappingByLineId.get(line.id);
    if (mappingId) {
      result.mapped.set(methodId, [
        ...(result.mapped.get(methodId) ?? []),
        planLine
      ]);
      result.mappedRows.set(methodId, [
        ...(result.mappedRows.get(methodId) ?? []),
        {
          mappingId,
          lineId: line.id,
          itemId: line.itemId,
          quantity: line.quantity,
          order: line.order,
          materialMakeMethodId: line.materialMakeMethodId
        }
      ]);
    } else {
      result.manual.set(methodId, [
        ...(result.manual.get(methodId) ?? []),
        planLine
      ]);
    }
  }
  return result;
}

/** The company's custom field definitions for the `part` table, one query. */
export async function loadPartCustomFieldDefinitions(
  client: Client,
  companyId: string
): Promise<
  Array<{
    id: string;
    name: string;
    dataTypeId: number;
    listOptions: string[] | null;
  }>
> {
  const rows = await client
    .from("customField")
    .select("id, name, dataTypeId, listOptions, active")
    .eq("companyId", companyId)
    .eq("table", "part")
    .order("sortOrder");
  // A failed read is not "no fields": resolving a map against [] would call
  // every mapped field deleted. Callers answer 500.
  if (rows.error) {
    throw new Error(
      `Failed to read custom field definitions: ${rows.error.message}`
    );
  }
  return (rows.data ?? [])
    .filter((row) => row.active !== false)
    .map((row) => ({
      id: row.id,
      name: row.name,
      dataTypeId: row.dataTypeId,
      listOptions: row.listOptions
    }));
}
