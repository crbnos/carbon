import { requirePermissions } from "@carbon/auth/auth.server";
import type { PartPlan, PlanItemRow, PlanMappingRow } from "@carbon/ee";
import {
  buildPartPlan,
  parsePropertyMap,
  resolveMappedFields
} from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadPartCustomFieldDefinitions,
  loadPlanOptions,
  OnshapeWVMType,
  readPartProperties
} from "@carbon/ee/onshape";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const config = {
  runtime: "nodejs"
};

const payloadSchema = z.object({
  documentId: z.string().min(1),
  // A push needs a place assets can be exported from: a workspace or a version.
  wv: z.enum(["w", "v"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1),
  partIds: z.array(z.string().min(1)).min(1).max(50)
});

const ITEM_COLUMNS = "id, readableId, revision, name, description, type";

/**
 * Plan a part push: what pushing these parts of the current Onshape element
 * would do to Carbon, with nothing written.
 *
 * The one live Onshape read a push needs (the element's part list) happens
 * here, so the apply that follows never touches Onshape — the plan carries
 * everything it needs, including each part's microversion, which is the only
 * "unchanged since last push" signal. When the company has mapped Onshape
 * properties to custom fields, one more metadata read resolves per-part
 * values into the plan — still zero Onshape reads at apply, and companies
 * with no map pay nothing. Carbon is read in bulk: the element's
 * mappings, every revision of the requested part numbers, and the items those
 * mappings point at (entityId has no foreign key, so a mapping can outlive its
 * item and must not read as a link).
 *
 * Permissions match the apply route so a user who cannot push fails here,
 * before reviewing and editing anything.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
    update: "parts"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid plan payload" }, { status: 400 });
  }
  const { documentId, wv, wvId, elementId } = parsed.data;
  const partIds = [...new Set(parsed.data.partIds)];

  const onshape = await getOnshapeClient(client, companyId, userId);
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
    parts = await onshape.client.getPartsInElement(document, elementId);
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "Onshape request failed"
      },
      { status: 502 }
    );
  }
  // Hidden parts are not shown in the panel, so they cannot be pushed either.
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
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .like("externalId", `${documentId}:${elementId}:%`),
    partNumbers.length > 0
      ? client
          .from("item")
          .select(ITEM_COLUMNS)
          .eq("companyId", companyId)
          .in("readableId", partNumbers)
          .order("revision")
      : Promise.resolve({ data: [], error: null }),
    loadPlanOptions(client, companyId),
    // The property map lives on the integration's plain metadata;
    // getOnshapeClient reads that row but does not expose it, so this is the
    // same RLS read once more, selecting only what the plan needs.
    client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", "onshape")
      .eq("companyId", companyId)
      .maybeSingle()
  ]);

  if (mappings.error) {
    return data({ error: "Failed to read Onshape mappings" }, { status: 500 });
  }
  if (matches.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  // A failed read must not silently plan a push without the mapped fields —
  // an "owned" field the user expects to follow every push would be skipped.
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

  // A linked item whose readableId differs from the Onshape part number (the
  // number changed after linking) is not in `matches`; load it by id so the
  // plan can tell a live link from a stale mapping row.
  const mappedItemIds = [
    ...new Set(
      mappingRows
        .map((row) => row.entityId)
        .filter((id) => !matchedItems.some((item) => item.id === id))
    )
  ];
  let mappedItems: PlanItemRow[] = [];
  if (mappedItemIds.length > 0) {
    const result = await client
      .from("item")
      .select(ITEM_COLUMNS)
      .eq("companyId", companyId)
      .in("id", mappedItemIds);
    if (result.error) {
      return data({ error: "Failed to read Carbon items" }, { status: 500 });
    }
    mappedItems = (result.data ?? []) as PlanItemRow[];
  }

  const rows = buildPartPlan({
    documentId,
    elementId,
    parts,
    requestedPartIds: partIds,
    mappings: mappingRows,
    items: [...matchedItems, ...mappedItems],
    options
  });
  // A requested id the element no longer has is dropped from the plan; when
  // that is all of them there is nothing to review.
  if (rows.length === 0) {
    return data(
      { error: "None of the selected parts are in this element" },
      { status: 422 }
    );
  }

  // Custom fields ride on the plan only when the company mapped properties:
  // the common no-map case must stay free (zero extra Onshape reads, rows
  // carry no customFields keys). Rows apply never writes skip resolution —
  // unchanged ones, and numberless ones it refuses outright — so an
  // all-unchanged plan is also free.
  const propertyMap = parsePropertyMap(integration.data?.metadata);
  const resolvable = rows.filter(
    (row) => row.action !== "unchanged" && row.action !== "skip-no-part-number"
  );
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
          resolvable.map((row) => row.partId)
        )
      ]);
    } catch (error) {
      // A property read that fails would silently break the owned-field
      // promise if the plan went out without values, so it fails the plan
      // the same way the part-list read does.
      return data(
        {
          error:
            error instanceof Error ? error.message : "Onshape request failed"
        },
        { status: 502 }
      );
    }
    for (const row of resolvable) {
      const resolved = resolveMappedFields({
        properties: properties.get(row.partId) ?? [],
        map: propertyMap,
        definitions
      });
      // Keys are set only when non-empty: rows the map does not touch look
      // exactly as they did before this feature, in store and response.
      if (resolved.fields.length > 0) row.customFields = resolved.fields;
      if (resolved.unmapped.length > 0) {
        row.unmappedProperties = resolved.unmapped;
      }
      if (resolved.problems.length > 0) {
        row.customFieldProblems = resolved.problems;
      }
    }
  }

  const plan: PartPlan = {
    kind: "part",
    documentId,
    wv,
    wvId,
    elementId,
    rows,
    options
  };
  const stored = await createPanelPlan({ companyId, userId, plan });
  if (!stored) {
    return data(
      { error: "Carbon could not store this review — try again" },
      { status: 503 }
    );
  }

  return data(
    { planId: stored.planId, expiresAt: stored.expiresAt, plan },
    { headers: { "Cache-Control": "no-store" } }
  );
}
