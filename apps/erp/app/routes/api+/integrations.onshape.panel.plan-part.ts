// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PartPlan, PlanItemRow, PlanMappingRow } from "@carbon/ee";
import {
  buildPartPlan,
  normalizeConfiguration,
  ownedCustomFieldsDiffer,
  parsePropertyMap,
  resolveMappedFields,
  withoutNoOpClears
} from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadPartCustomFieldDefinitions,
  loadPlanOptions,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeWVMType,
  onshapeFailure,
  selectInBatches
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { readPartProperties } from "@carbon/ee/onshape.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const config = {
  runtime: "nodejs"
};

const payloadSchema = z.object({
  documentId: z.string().min(1),
  // Exports need a workspace or a version, not a microversion.
  wv: z.enum(["w", "v"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1),
  /** The Part Studio configuration the panel was opened in; absent = default. */
  configuration: z.string().nullish(),
  partIds: z.array(z.string().min(1)).min(1).max(50)
});

const ITEM_COLUMNS =
  "id, readableId, revision, active, name, description, type, replenishmentSystem, defaultMethodType, itemTrackingType";

/** Plan a part push without writing; the apply makes no Onshape call. */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      create: "parts",
      update: "parts"
    }
  );

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid plan payload" }, { status: 400 });
  }
  const { documentId, wv, wvId, elementId } = parsed.data;
  const configuration = normalizeConfiguration(parsed.data.configuration);
  const partIds = [...new Set(parsed.data.partIds)];

  const onshape = await getOnshapeClient(
    client,
    companyId,
    userId,
    ONSHAPE_V2_INTEGRATION_ID
  );
  if (onshape.error || !onshape.client) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  const document: OnshapeDocument = {
    documentId,
    wvm: wv === "w" ? OnshapeWVMType.WORKSPACE : OnshapeWVMType.VERSION,
    wvmId: wvId
  };

  let parts: Awaited<ReturnType<typeof onshape.client.getPartsInElement>>;
  try {
    parts = await onshape.client.getPartsInElement(
      document,
      elementId,
      configuration
    );
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }
  // Hidden parts are not shown in the panel, so they cannot be pushed.
  parts = parts.filter((part) => !part.isHidden);

  const requested = parts.filter((part) => partIds.includes(part.partId));
  const partNumbers = [
    ...new Set(
      requested
        .map((part) => part.partNumber)
        .filter((number): number is string => !!number)
    )
  ];

  const [mappings, matches, options, integration] = await Promise.all([
    client
      .from("externalIntegrationMapping")
      .select("entityId, externalId, lastSyncedAt, metadata")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "item")
      .like("externalId", `${documentId}:${elementId}:%`),
    selectInBatches(partNumbers, (batch) =>
      client
        .from("item")
        .select(ITEM_COLUMNS)
        .eq("companyId", companyId)
        .in("readableId", batch)
        .order("revision")
    ),
    loadPlanOptions(client, companyId),
    // getOnshapeClient reads this row but does not expose its metadata.
    client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);

  if (mappings.error) {
    return data({ error: "Failed to read Onshape mappings" }, { status: 500 });
  }
  if (matches.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  // Planning without the map would silently skip owned fields.
  if (integration.error) {
    return data(
      { error: "Failed to read the Onshape property map" },
      { status: 500 }
    );
  }

  const mappingRows: PlanMappingRow[] = (mappings.data ?? []).map((row) => ({
    entityId: row.entityId,
    externalId: row.externalId,
    lastSyncedAt: row.lastSyncedAt,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null
  }));
  const matchedItems = (matches.data ?? []) as PlanItemRow[];

  // An item renumbered after linking is not in `matches`; loading it by id
  // tells a live link from a stale mapping row.
  const mappedItemIds = [
    ...new Set(
      mappingRows
        .map((row) => row.entityId)
        .filter((id) => !matchedItems.some((item) => item.id === id))
    )
  ];
  const mappedResult = await selectInBatches(mappedItemIds, (batch) =>
    client
      .from("item")
      .select(ITEM_COLUMNS)
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (mappedResult.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const mappedItems = mappedResult.data as PlanItemRow[];

  const rows = buildPartPlan({
    documentId,
    elementId,
    configuration,
    parts,
    requestedPartIds: partIds,
    mappings: mappingRows,
    items: [...matchedItems, ...mappedItems],
    options
  });
  if (rows.length === 0) {
    return data(
      { error: "None of the selected parts are in this element" },
      { status: 422 }
    );
  }

  // No map means no extra Onshape reads. Unchanged rows still resolve: a
  // property mapped after the last push must reach Carbon.
  const propertyMap = parsePropertyMap(integration.data?.metadata);
  const resolvable = rows.filter((row) => row.action !== "skip-no-part-number");
  if (propertyMap.length > 0 && resolvable.length > 0) {
    let definitions: Awaited<ReturnType<typeof loadPartCustomFieldDefinitions>>;
    let properties: Awaited<ReturnType<typeof readPartProperties>>;
    try {
      [definitions, properties] = await Promise.all([
        loadPartCustomFieldDefinitions(client, companyId),
        readPartProperties(
          onshape.client,
          document,
          elementId,
          resolvable.map((row) => row.partId),
          configuration
        )
      ]);
    } catch (error) {
      const failure = onshapeFailure(error);
      return data(failure.body, { status: failure.status });
    }
    for (const row of resolvable) {
      const resolved = resolveMappedFields({
        properties: properties.get(row.partId) ?? [],
        map: propertyMap,
        definitions
      });
      if (resolved.fields.length > 0) row.customFields = resolved.fields;
      if (resolved.unmapped.length > 0) {
        row.unmappedProperties = resolved.unmapped;
      }
      if (resolved.problems.length > 0) {
        row.customFieldProblems = resolved.problems;
      }
    }

    // An unchanged row becomes an update (no model export) only when its mapped
    // fields differ from Carbon's; no row clears a field Carbon doesn't hold.
    const existing = resolvable.filter(
      (row) => row.item && (row.customFields ?? []).length > 0
    );
    const held = await selectInBatches(
      [
        ...new Set(
          existing.flatMap((row) => (row.item ? [row.item.readableId] : []))
        )
      ],
      (batch) =>
        client
          .from("part")
          .select("id, customFields")
          .eq("companyId", companyId)
          .in("id", batch)
    );
    if (held.error) {
      return data({ error: "Failed to read Carbon parts" }, { status: 500 });
    }
    const heldByReadableId = new Map(
      (held.data ?? []).map((part) => [part.id, part.customFields])
    );
    for (const row of existing) {
      const current = row.item
        ? heldByReadableId.get(row.item.readableId)
        : undefined;
      if (row.action === "unchanged") {
        if (!ownedCustomFieldsDiffer(current, row.customFields ?? [])) {
          delete row.customFields;
          continue;
        }
        row.action = "update";
        row.cadUnchanged = true;
      }
      const fields = withoutNoOpClears(current, row.customFields ?? []);
      if (fields.length > 0) row.customFields = fields;
      else delete row.customFields;
    }
  }

  const plan: PartPlan = {
    kind: "part",
    documentId,
    wv,
    wvId,
    elementId,
    configuration,
    rows,
    options
  };
  const stored = await createPanelPlan({ companyId, userId, plan });
  if (!stored) {
    return data(
      { error: "Carbon couldn't save this review. Try again." },
      { status: 503 }
    );
  }

  return data(
    { planId: stored.planId, expiresAt: stored.expiresAt, plan },
    { headers: { "Cache-Control": "no-store" } }
  );
}
