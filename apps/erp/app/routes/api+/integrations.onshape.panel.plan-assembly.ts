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
  /** The assembly configuration the panel was opened in; absent = default. */
  configuration: z.string().nullish()
});

/**
 * The most distinct part numbers one push will plan.
 *
 * Not a technical limit — the reads are batched and the writes are bulk — but
 * a push is one HTTP request with no rollback, so a very large one can be cut
 * off by a gateway halfway through, leaving a partly written BOM.
 *
 * A `top` push is bounded by one level and is never refused.
 */
const MAX_PLAN_PARTS = 1500;

/**
 * Plan an assembly push: read the BOM and the assembly's identity from
 * Onshape, join them to Carbon, and return what `push-assembly` would do —
 * every item it would create (with the values it would use), every make
 * method it would touch and the lines each would gain, lose or keep — without
 * writing anything. The plan is stored server-side with the parsed BOM so the
 * apply never reads Onshape again: the two live calls here (BOM + element
 * metadata) are the push's whole quota cost.
 *
 * Permissions match the apply so a user who could not push fails here,
 * before reviewing.
 */
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

  // The indented BOM never carries the assembly's own row; its identity comes
  // from element metadata, with the BOM root as the fallback when present.
  const { root: bomRoot, lines, missingColumns } = parseBomTree(bom);
  // An unreadable tree plans as "the assembly has no lines", and the apply
  // would then remove every Onshape-origin line from the method.
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
  // A failed read is kept, not swallowed: identity may still come from the
  // BOM root, but the mapped fields cannot, and the property-map block below
  // refuses to plan without them.
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
    // A read that failed is not an assembly without a part number: telling
    // the user to fix their Onshape data would send them the wrong way.
    if (metadataError !== null) {
      const failure = onshapeFailure(metadataError);
      return data(failure.body, { status: failure.status });
    }
    return data(
      { error: "Set a part number on the assembly in Onshape first" },
      { status: 422 }
    );
  }

  // ---- Carbon side, all bulk --------------------------------------------
  // At `top` depth the push writes one method, so only the root's own children
  // are planned; the rest of the tree belongs to its own push.
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
    /*
     * "Push the sub-assemblies first" cannot work: this count is over the
     * WHOLE tree regardless of what is already in Carbon, so the parent is
     * refused just the same afterwards. A level-only push is the way out, and
     * `code` lets the panel offer it as a button.
     */
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
  // item.revision is nullable; the builders read a missing one as "0", the
  // same default pickAdoptTarget and proposeItem use.
  const items: PlanItemRow[] = existing.data.map((row) => ({
    ...row,
    revision: row.revision ?? "0"
  }));

  // Parents are the root and every node with children: only their make
  // methods get lines, so only those methods' line ownership is read. Every
  // revision row of a parent part number is included so the ownership read
  // covers whichever row the builder pins.
  const parentPartNumbers = new Set<string>([rootPartNumber]);
  for (const node of allNodes) {
    if (node.partNumber && node.children.length > 0) {
      parentPartNumbers.add(node.partNumber);
    }
  }
  const parentItemIds = items
    .filter((item) => parentPartNumbers.has(item.readableId))
    .map((item) => item.id);

  // The links the status badges read, so the review can tell a reuse the user
  // already linked from one found by part number alone (a conflict).
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
  const [options, methods, links] = await Promise.all([
    loadPlanOptions(client, companyId),
    // Settled here so the other reads still resolve; a failure answers 500
    // below rather than planning every existing method as missing.
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
  if (links.error) {
    return data(
      { error: "Carbon couldn't read its Onshape links. Try again." },
      { status: 500 }
    );
  }
  const linkedItemIdByExternalId = new Map<string, string>();
  for (const link of links.data ?? []) {
    if (link.externalId) {
      linkedItemIdByExternalId.set(link.externalId, link.entityId);
    }
  }
  // A released method is pushed through a Draft; the review shows the one
  // the push will reuse, or the Active method a new Draft would copy.
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
    configuration,
    reusableDraftByItemId
  });

  // ---- Root custom fields (property map) ---------------------------------
  // The Onshape→custom-field map lives on the integration's settings
  // metadata (getOnshapeClient read the same row but returns only a client,
  // so this is one more RLS-scoped select). Only the ROOT item resolves
  // fields — child items get theirs when their own part studio is pushed —
  // and only from the element metadata already fetched above, so the map
  // costs no extra Onshape call.
  if (elementMetadata !== null || metadataError !== null) {
    const integration = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", ONSHAPE_V2_INTEGRATION_ID)
      .eq("companyId", companyId)
      .maybeSingle();
    // A failed read must not silently plan a push without the mapped fields —
    // an "owned" field the user expects to follow every push would be skipped.
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
        // The read throws rather than answering []: resolving the map against
        // no definitions would read as "every mapped field was deleted".
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
      // A reused root reads Carbon's values so the review never claims to
      // clear a field Carbon doesn't hold. `part` is keyed by readableId.
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

  // The parsed BOM rides along server-side: apply walks it for line order
  // and child part links, and the panel never needs it.
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
