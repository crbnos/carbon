// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { PlanItemRow } from "@carbon/ee";
import {
  buildAssemblyPlan,
  externalIdForAssembly,
  externalIdForBomLine,
  flattenNodes,
  metadataProperty,
  missingBomColumnsMessage,
  normalizeConfiguration,
  parseBomTree,
  parseProperties,
  parsePropertyMap,
  resolveMappedFields,
  withoutNoOpClears
} from "@carbon/ee";
import type { OnshapeDocument, StoredAssemblyPlan } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadActiveMakeMethods,
  loadMethodLineOwnership,
  loadPartCustomFieldDefinitions,
  loadPlanOptions,
  loadReusableDrafts,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeWVMType,
  onshapeFailure,
  selectInBatches
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const config = {
  runtime: "nodejs"
};

const payloadSchema = z.object({
  documentId: z.string().min(1),
  wv: z.enum(["w", "v"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1),
  depth: z.enum(["all", "top"]).default("all"),
  configuration: z.string().nullish()
});

/**
 * Most distinct part numbers one push plans. A push is one request with no
 * rollback, so a gateway can cut a large one off mid-BOM. `top` is exempt.
 */
const MAX_PLAN_PARTS = 1500;

/** Plan an assembly push without writing; the apply reuses the stored plan. */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      create: "parts",
      update: "parts",
      // Re-pushing replaces the BOM lines an earlier push wrote.
      delete: "parts"
    }
  );

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid plan payload" }, { status: 400 });
  }
  const { documentId, wv, wvId, elementId, depth } = parsed.data;
  const configuration = normalizeConfiguration(parsed.data.configuration);

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

  let bom: unknown;
  try {
    bom = await onshape.client.getBillOfMaterialsIn(
      document,
      elementId,
      configuration
    );
  } catch (error) {
    const failure = onshapeFailure(error, "bom");
    return data(failure.body, { status: failure.status });
  }

  // The indented BOM omits the assembly's own row; element metadata names it.
  const { root: bomRoot, lines, missingColumns } = parseBomTree(bom);
  // An empty plan from an unreadable tree would drop every Onshape line.
  if (missingColumns.length > 0) {
    return data(
      { error: missingBomColumnsMessage(missingColumns) },
      { status: 422 }
    );
  }
  let rootPartNumber = bomRoot?.partNumber ?? null;
  let rootName = bomRoot?.name ?? null;
  let rootDescription = bomRoot?.description ?? null;
  const rootRevision = bomRoot?.revision ?? null;
  let elementMetadata: unknown = null;
  let metadataError: unknown = null;
  try {
    elementMetadata = await onshape.client.getElementMetadata(
      document,
      elementId,
      configuration
    );
    rootPartNumber =
      metadataProperty(elementMetadata, "Part number") ?? rootPartNumber;
    rootName = metadataProperty(elementMetadata, "Name") ?? rootName;
    rootDescription =
      metadataProperty(elementMetadata, "Description") ?? rootDescription;
  } catch (error) {
    metadataError = error;
  }
  if (!rootPartNumber) {
    // A failed read is not a missing part number; report the read failure.
    if (metadataError !== null) {
      const failure = onshapeFailure(metadataError);
      return data(failure.body, { status: failure.status });
    }
    return data(
      { error: "Set a part number on the assembly in Onshape first" },
      { status: 422 }
    );
  }

  const allNodes = depth === "top" ? lines : flattenNodes(lines);
  const partNumbers = [
    ...new Set(
      [rootPartNumber, ...allNodes.map((node) => node.partNumber)].filter(
        (n): n is string => !!n
      )
    )
  ];
  if (depth === "all" && partNumbers.length > MAX_PLAN_PARTS) {
    const subAssemblies = lines.filter(
      (node) => node.children.length > 0
    ).length;
    // The count covers the whole tree whatever Carbon holds, so pushing the
    // sub-assemblies first does not help; `code` lets the panel offer `top`.
    return data(
      {
        code: "too-large" as const,
        error:
          `It has ${partNumbers.length.toLocaleString("en-US")} distinct part numbers; one push handles ${MAX_PLAN_PARTS.toLocaleString("en-US")}. ` +
          (subAssemblies > 0
            ? `Push this level on its own — its ${subAssemblies} sub-assemblies become single lines, and each can then be pushed from its own tab in Onshape.`
            : "Split it into sub-assemblies in Onshape, then push this level on its own.")
      },
      { status: 422 }
    );
  }

  const existing = await selectInBatches(partNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, active, name, description, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const items: PlanItemRow[] = existing.data.map((row) => ({
    ...row,
    revision: row.revision ?? "0"
  }));

  // Every revision row of a parent is included so the ownership read covers
  // whichever row the builder pins.
  const parentPartNumbers = new Set<string>([rootPartNumber]);
  for (const node of allNodes) {
    if (node.partNumber && node.children.length > 0) {
      parentPartNumbers.add(node.partNumber);
    }
  }
  const parentItemIds = items
    .filter((item) => parentPartNumbers.has(item.readableId))
    .map((item) => item.id);

  const linkExternalIds = [
    ...new Set(
      [
        externalIdForAssembly(documentId, elementId, configuration),
        ...flattenNodes(lines).map((node) =>
          externalIdForBomLine(node.itemSource ?? null)
        )
      ].filter((id): id is string => !!id)
    )
  ];

  const serviceRole = getCarbonServiceRole();
  const [options, methods, links, itemLinks] = await Promise.all([
    loadPlanOptions(client, companyId),
    // Settled so a failure answers 500 instead of planning methods as missing.
    loadActiveMakeMethods(client, companyId, parentItemIds).then(
      (byItemId) => ({ byItemId, error: null }),
      (error: unknown) => ({ byItemId: null, error })
    ),
    selectInBatches(linkExternalIds, (batch) =>
      client
        .from("externalIntegrationMapping")
        .select("entityId, externalId")
        .eq("companyId", companyId)
        .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
        .eq("entityType", "item")
        .in("externalId", batch)
    ),
    // An item linked elsewhere keeps its link, and this push leaves its text.
    selectInBatches(
      items.map((item) => item.id),
      (batch) =>
        client
          .from("externalIntegrationMapping")
          .select("entityId")
          .eq("companyId", companyId)
          .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
          .eq("entityType", "item")
          .in("entityId", batch)
    )
  ]);
  if (!methods.byItemId) {
    return data(
      {
        error:
          methods.error instanceof Error
            ? methods.error.message
            : "Failed to read the make methods"
      },
      { status: 500 }
    );
  }
  const methodByItemId = methods.byItemId;
  // A failed read would mark every reuse a conflict; say so instead.
  if (links.error || itemLinks.error) {
    return data(
      { error: "Carbon couldn't read its Onshape links. Try again." },
      { status: 500 }
    );
  }
  const linkedItemIds = new Set(
    (itemLinks.data ?? []).map((link) => link.entityId)
  );
  const linkedItemIdByExternalId = new Map<string, string>();
  for (const link of links.data ?? []) {
    if (link.externalId) {
      linkedItemIdByExternalId.set(link.externalId, link.entityId);
    }
  }
  let reusableDraftByItemId: Awaited<ReturnType<typeof loadReusableDrafts>>;
  let ownership: Awaited<ReturnType<typeof loadMethodLineOwnership>>;
  try {
    reusableDraftByItemId = await loadReusableDrafts(
      client,
      serviceRole,
      companyId,
      new Map(
        [...methodByItemId.entries()]
          .filter(([, method]) => method.status === "Active")
          .map(([itemId, method]) => [itemId, method.id])
      )
    );
    ownership = await loadMethodLineOwnership(client, serviceRole, companyId, [
      ...[...methodByItemId.values()].map((method) => method.id),
      ...[...reusableDraftByItemId.values()].map((draft) => draft.id)
    ]);
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the existing BOM lines"
      },
      { status: 500 }
    );
  }

  const plan = buildAssemblyPlan({
    documentId,
    wv,
    wvId,
    elementId,
    root: {
      partNumber: rootPartNumber,
      name: rootName,
      description: rootDescription,
      revision: rootRevision
    },
    nodes: lines,
    items,
    methodByItemId,
    mappedLinesByMethodId: ownership.mapped,
    manualLinesByMethodId: ownership.manual,
    options,
    depth,
    linkedItemIdByExternalId,
    linkedItemIds,
    configuration,
    reusableDraftByItemId
  });

  // Root custom fields only (children get theirs from their own part push),
  // from the metadata read above, so the map costs no extra Onshape call.
  if (elementMetadata !== null || metadataError !== null) {
    const integration = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle();
    // A failed read must not plan a push that silently skips owned fields.
    if (integration.error) {
      return data(
        { error: "Failed to read the Onshape property map" },
        { status: 500 }
      );
    }
    const propertyMap = parsePropertyMap(integration.data?.metadata);
    if (propertyMap.length > 0 && elementMetadata === null) {
      const failure = onshapeFailure(metadataError);
      return data(failure.body, { status: failure.status });
    }
    if (propertyMap.length > 0) {
      let definitions: Awaited<
        ReturnType<typeof loadPartCustomFieldDefinitions>
      >;
      try {
        definitions = await loadPartCustomFieldDefinitions(client, companyId);
      } catch (error) {
        // Never fall back to []: it would read as every mapped field deleted.
        return data(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to read the custom field definitions"
          },
          { status: 500 }
        );
      }
      const resolved = resolveMappedFields({
        properties: parseProperties(elementMetadata),
        map: propertyMap,
        definitions
      });
      let fields = resolved.fields;
      // A reused root drops clears of fields Carbon doesn't hold.
      // `part` is keyed by readableId.
      if (plan.root.action === "reuse" && fields.length > 0) {
        const held = await client
          .from("part")
          .select("customFields")
          .eq("id", plan.root.partNumber)
          .eq("companyId", companyId)
          .maybeSingle();
        if (held.error) {
          return data(
            { error: "Failed to read Carbon parts" },
            { status: 500 }
          );
        }
        fields = withoutNoOpClears(held.data?.customFields, fields);
      }
      if (fields.length > 0) {
        plan.root.customFields = fields;
      }
      if (resolved.unmapped.length > 0) {
        plan.root.unmappedProperties = resolved.unmapped;
      }
      if (resolved.problems.length > 0) {
        plan.root.customFieldProblems = resolved.problems;
      }
    }
  }

  // The parsed BOM is stored for the apply; the panel never needs it.
  const stored: StoredAssemblyPlan = { ...plan, nodes: lines };
  const created = await createPanelPlan({ companyId, userId, plan: stored });
  if (!created) {
    return data(
      { error: "Carbon couldn't save this review. Try again." },
      { status: 503 }
    );
  }

  return data(
    { planId: created.planId, expiresAt: created.expiresAt, plan },
    { headers: { "Cache-Control": "no-store" } }
  );
}
