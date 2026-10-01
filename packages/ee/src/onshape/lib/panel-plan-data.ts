import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRAFT_MARKER_ENTITY_TYPE,
  type DraftCandidate,
  pickReusableDraft
} from "../panel/method-version";
import type { PlanLine, PlanMethodRow, PlanOptions } from "../panel/plan";
import { parsePushDefaults } from "../panel/preferences";
import { selectInBatches } from "./batched-filter";
import { ONSHAPE_V2_INTEGRATION_ID } from "./integration-id";

/**
 * Carbon reads the panel's plan and apply routes share. Every function here
 * takes the ids it needs in one call and returns plain maps the pure builders
 * in `panel/plan.ts` consume.
 *
 * "One call" is bounded by the gateway: an `.in()` list rides in the URL and
 * the request line dies past 4 KB. Every list sized by the BOM therefore goes
 * through `selectInBatches`, which splits on encoded bytes — a count would be
 * wrong, since these ids range from 22 to 58 characters.
 */

type Client = SupabaseClient<Database>;

/**
 * The company's units and its configured push defaults — everything the pure
 * planners need that is neither Onshape's nor the user's. Both reads are
 * fail-soft: no units yields the "EA" fallback, and unreadable settings yield
 * the documented defaults, because a plan must always build.
 */
export async function loadPlanOptions(
  client: Client,
  companyId: string
): Promise<PlanOptions> {
  const [units, integration] = await Promise.all([
    client
      .from("unitOfMeasure")
      .select("code, name")
      .eq("companyId", companyId)
      .order("name"),
    client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  return {
    unitsOfMeasure: (units.data ?? []).map((unit) => ({
      code: unit.code,
      name: unit.name
    })),
    defaults: parsePushDefaults(integration.data?.metadata)
  };
}

/**
 * Throws on a failed read: an empty map reads as "no method" for every item,
 * so a plan would call every existing method missing and an apply would skip
 * or flatten every BOM. Callers answer 500.
 */
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
  if (rows.error) {
    throw new Error(`Failed to read make methods: ${rows.error.message}`);
  }
  const byItemId = new Map<string, PlanMethodRow>();
  for (const row of rows.data ?? []) {
    if (row.id && row.itemId) {
      byItemId.set(row.itemId, { id: row.id, status: row.status ?? "Draft" });
    }
  }
  return byItemId;
}

/**
 * For each item whose method is Active, the Draft a push would write into
 * rather than create (`pickReusableDraft`). Items with none are absent: the
 * push creates a new Draft from the Active method. Throws on a failed read —
 * "no reusable Draft" would make every push mint another version.
 */
export async function loadReusableDrafts(
  client: Client,
  serviceRole: Client,
  companyId: string,
  activeMethodIdByItemId: Map<string, string>
): Promise<Map<string, DraftCandidate>> {
  const itemIds = [...activeMethodIdByItemId.keys()];
  const result = new Map<string, DraftCandidate>();
  if (itemIds.length === 0) return result;

  const drafts = await selectInBatches(itemIds, (batch) =>
    client
      .from("makeMethod")
      .select("id, itemId, version, changeOrderId")
      .eq("companyId", companyId)
      .eq("status", "Draft")
      .in("itemId", batch)
  );
  if (drafts.error) {
    throw new Error(
      `Failed to read Draft make methods: ${drafts.error.message}`
    );
  }
  const draftIds = (drafts.data ?? []).map((draft) => draft.id);
  const markers = await selectInBatches(draftIds, (batch) =>
    serviceRole
      .from("externalIntegrationMapping")
      .select("entityId, metadata")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", DRAFT_MARKER_ENTITY_TYPE)
      .in("entityId", batch)
  );
  if (markers.error) {
    throw new Error(
      `Failed to read the Onshape Draft markers: ${markers.error.message}`
    );
  }
  const markerRows = (markers.data ?? []).map((row) => ({
    draftId: row.entityId,
    sourceMethodId:
      ((row.metadata as Record<string, unknown> | null)?.sourceMethodId as
        | string
        | undefined) ?? null
  }));

  const draftsByItemId = new Map<string, DraftCandidate[]>();
  for (const draft of drafts.data ?? []) {
    if (!draft.itemId) continue;
    const list = draftsByItemId.get(draft.itemId) ?? [];
    list.push({
      id: draft.id,
      version: draft.version ?? null,
      changeOrderId: draft.changeOrderId ?? null
    });
    draftsByItemId.set(draft.itemId, list);
  }
  for (const [itemId, activeMethodId] of activeMethodIdByItemId) {
    const chosen = pickReusableDraft(
      draftsByItemId.get(itemId) ?? [],
      markerRows,
      activeMethodId
    );
    if (chosen) result.set(itemId, chosen);
  }
  return result;
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

/**
 * A line nothing pushed, as it stands in Carbon. A push takes one over when
 * Onshape's BOM lists the same part number: it is updated in place and gains
 * an ownership row, rather than getting an Onshape copy beside it.
 */
export type ManualLineRow = {
  lineId: string;
  itemId: string;
  readableId: string;
  /** The line's own item type: only a line of the same type is taken over. */
  itemType: string | null;
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
  /** The manual rows apply can take over, per method id, in line order. */
  manualRows: Map<string, ManualLineRow[]>;
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
    mappedRows: new Map(),
    manualRows: new Map()
  };
  if (ids.length === 0) return result;

  const [lines, mappings] = await Promise.all([
    selectInBatches(ids, (batch) =>
      client
        .from("methodMaterial")
        .select(
          "id, makeMethodId, itemId, itemType, quantity, order, materialMakeMethodId"
        )
        .eq("companyId", companyId)
        .in("makeMethodId", batch)
    ),
    selectInBatches(ids, (batch) =>
      serviceRole
        .from("externalIntegrationMapping")
        .select("id, entityId, metadata")
        .eq("companyId", companyId)
        .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
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
  // Without it every line's part number falls back to an item uuid, which the
  // review shows as the component of each replaced and kept line.
  if (items.error) {
    throw new Error(
      `Failed to read the existing BOM lines: ${items.error.message}`
    );
  }
  const readableIdByItemId = new Map(
    (items.data ?? []).map((item) => [item.id, item.readableId])
  );

  const append = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) {
      list.push(value);
    } else {
      map.set(key, [value]);
    }
  };

  // Line order, so plan and apply pair a part number's lines the same way.
  const ordered = [...(lines.data ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  for (const line of ordered) {
    const methodId = line.makeMethodId;
    if (!methodId) continue;
    const planLine: PlanLine = {
      readableId: readableIdByItemId.get(line.itemId) ?? line.itemId,
      quantity: line.quantity
    };
    const mappingId = mappingByLineId.get(line.id);
    if (mappingId) {
      append(result.mapped, methodId, planLine);
      append(result.mappedRows, methodId, {
        mappingId,
        lineId: line.id,
        itemId: line.itemId,
        quantity: line.quantity,
        order: line.order,
        materialMakeMethodId: line.materialMakeMethodId
      });
    } else {
      append(result.manual, methodId, { ...planLine, itemType: line.itemType });
      append(result.manualRows, methodId, {
        lineId: line.id,
        itemId: line.itemId,
        readableId: planLine.readableId,
        itemType: line.itemType,
        quantity: line.quantity,
        order: line.order,
        materialMakeMethodId: line.materialMakeMethodId
      });
    }
  }
  return result;
}

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
