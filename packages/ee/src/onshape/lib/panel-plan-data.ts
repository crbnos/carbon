// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRAFT_MARKER_ENTITY_TYPE,
  type DraftCandidate,
  pickReusableDraft
} from "../panel/method-version";
import type {
  PlanLine,
  PlanMappingContext,
  PlanMethodRow,
  PlanOptions
} from "../panel/plan";
import { parsePushDefaults } from "../panel/preferences";
import { parseDescriptionModes, parsePropertyMap } from "../panel/properties";
import {
  type ReleasedRevision,
  releasedRevisionsByPartNumber
} from "../panel/status";
import { selectInBatches } from "./batched-filter";
import { ONSHAPE_V2_INTEGRATION_ID } from "./integration-id";

// The plan and apply routes reach the panel's pure helpers through this barrel.
export { withRefusedMethods } from "../panel/plan";

// Carbon reads shared by the panel's plan and apply routes.

type Client = SupabaseClient<Database>;

/**
 * Fail-soft so a plan always builds. Takes the service role: the
 * `companyIntegration` SELECT needs settings view, so through a user's client
 * the row reads as absent and every push takes the built-in defaults.
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
 * Throws on a failed read: an empty map reads as "no method" everywhere. With
 * no Active method the view returns the newest Draft, which can be a change
 * notice's; `changeOrderId` says so (the view does not carry it).
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
  const draftIds = (rows.data ?? [])
    .filter((row) => row.id && row.status !== "Active")
    .map((row) => row.id as string);
  const owners = await selectInBatches(draftIds, (batch) =>
    client
      .from("makeMethod")
      .select("id, changeOrderId")
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (owners.error) {
    throw new Error(`Failed to read make methods: ${owners.error.message}`);
  }
  const changeOrderIdByMethodId = new Map(
    owners.data.map((row) => [row.id, row.changeOrderId])
  );
  const byItemId = new Map<string, PlanMethodRow>();
  for (const row of rows.data ?? []) {
    if (row.id && row.itemId) {
      byItemId.set(row.itemId, {
        id: row.id,
        status: row.status ?? "Draft",
        changeOrderId: changeOrderIdByMethodId.get(row.id) ?? null
      });
    }
  }
  return byItemId;
}

/**
 * Per part number, the newest revision with a `release:` link. Throws on a
 * failed read, so a workspace push never writes into a released part.
 */
export async function loadReleasedRevisions(
  client: Client,
  companyId: string,
  items: Array<{ id: string; readableId: string; revision: string | null }>
): Promise<Map<string, ReleasedRevision>> {
  const ids = [...new Set(items.map((item) => item.id))];
  if (ids.length === 0) return new Map();
  const rows = await selectInBatches(ids, (batch) =>
    client
      .from("externalIntegrationMapping")
      .select("entityId")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "item")
      .like("externalId", "release:%")
      .in("entityId", batch)
  );
  if (rows.error) {
    throw new Error(`Failed to read the release links: ${rows.error.message}`);
  }
  return releasedRevisionsByPartNumber(
    items,
    new Set((rows.data ?? []).map((row) => row.entityId))
  );
}

/**
 * Per item with an Active method, the Draft a push would reuse. Throws on a
 * failed read, which would otherwise make every push mint another version.
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

/** Carries the push-owned columns so apply can skip an unchanged line. */
export type MappedLineRow = {
  mappingId: string;
  lineId: string;
  itemId: string;
  quantity: number | null;
  order: number | null;
  materialMakeMethodId: string | null;
};

/** A push takes a manual line over when Onshape lists the same part number. */
export type ManualLineRow = {
  lineId: string;
  itemId: string;
  readableId: string;
  /** Only a line of the same item type is taken over. */
  itemType: string | null;
  quantity: number | null;
  order: number | null;
  materialMakeMethodId: string | null;
};

export type MethodLineOwnership = {
  /** Lines a previous push wrote, per method id. */
  mapped: Map<string, PlanLine[]>;
  manual: Map<string, PlanLine[]>;
  /**
   * `itemId` pairs a line with its write so it is updated in place; a reinsert
   * would drop its operation, scrap and custom fields.
   */
  mappedRows: Map<string, MappedLineRow[]>;
  /** In line order. */
  manualRows: Map<string, ManualLineRow[]>;
};

/**
 * Line provenance lives only in `externalIntegrationMapping` (`methodMaterial`
 * rows keyed by `metadata.makeMethodId`), read with the service role.
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

  // Read as empty, a failure would make apply rewrite a method without deleting
  // its lines.
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

  // Batches arrive in batch order; plan and apply must pair lines the same way.
  const ordered = [...(lines.data ?? [])].sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
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
  // Read as empty, a failure would mark every mapped custom field deleted.
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

/**
 * Reads custom field definitions and held values only when the map targets a
 * custom field. Takes the service role for the reason `loadPlanOptions` gives.
 */
export async function loadPlanMapping(
  client: Client,
  companyId: string,
  readableIds: string[]
): Promise<PlanMappingContext> {
  const integration = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", ONSHAPE_V2_INTEGRATION_ID)
    .eq("companyId", companyId)
    .maybeSingle();
  if (integration.error) {
    throw new Error(
      `Failed to read the Onshape property map: ${integration.error.message}`
    );
  }
  const metadata = integration.data?.metadata;
  const map = parsePropertyMap(metadata);
  const descriptionModes = parseDescriptionModes(metadata);
  const heldCustomFields = new Map<string, unknown>();
  if (!map.some((entry) => entry.target.kind === "customField")) {
    return { map, definitions: [], descriptionModes, heldCustomFields };
  }
  const [definitions, held] = await Promise.all([
    loadPartCustomFieldDefinitions(client, companyId),
    selectInBatches([...new Set(readableIds)], (batch) =>
      client
        .from("part")
        .select("id, customFields")
        .eq("companyId", companyId)
        .in("id", batch)
    )
  ]);
  if (held.error) {
    throw new Error(`Failed to read Carbon parts: ${held.error.message}`);
  }
  for (const part of held.data ?? []) {
    heldCustomFields.set(part.id, part.customFields);
  }
  return { map, definitions, descriptionModes, heldCustomFields };
}
