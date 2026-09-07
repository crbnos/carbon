import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { PlanItemRow } from "@carbon/ee";
import {
  buildAssemblyPlan,
  flattenNodes,
  metadataProperty,
  parseBomTree,
  parseProperties,
  parsePropertyMap,
  resolveMappedFields
} from "@carbon/ee";
import type { OnshapeDocument, StoredAssemblyPlan } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadActiveMakeMethods,
  loadMethodLineOwnership,
  loadPartCustomFieldDefinitions,
  loadPlanOptions,
  OnshapeWVMType,
  selectInBatches
} from "@carbon/ee/onshape";
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
  /** Omitted by older panels, which only ever pushed the whole tree. */
  depth: z.enum(["all", "top"]).default("all")
});

/**
 * The most distinct part numbers one push will plan.
 *
 * Not a technical limit — the reads are batched and the writes are bulk — but
 * a push is one HTTP request with no rollback, so a very large one is a long
 * wait that can be cut off by a gateway halfway through, leaving a partly
 * written BOM. Refusing with a number, and naming the level-by-level route
 * out, beats a timeout the user cannot interpret.
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
 * metadata, usually the dev cache) are the push's whole quota cost.
 *
 * When the company maps Onshape properties to custom fields, the ROOT item's
 * fields resolve here from the element metadata payload already read for
 * identity — the map costs zero extra Onshape calls, whatever its size.
 *
 * Permissions match the apply so a user who could not push fails here,
 * before reviewing.
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
  const { documentId, wv, wvId, elementId, depth } = parsed.data;

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

  let bom: unknown;
  try {
    bom = await onshape.client.getBillOfMaterialsIn(document, elementId);
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "Onshape request failed"
      },
      { status: 502 }
    );
  }

  // The indented BOM never carries the assembly's own row; its identity comes
  // from element metadata, with the BOM root as the fallback when present.
  const { root: bomRoot, lines } = parseBomTree(bom);
  let rootPartNumber = bomRoot?.partNumber ?? null;
  let rootName = bomRoot?.name ?? null;
  let rootDescription = bomRoot?.description ?? null;
  const rootRevision = bomRoot?.revision ?? null;
  // Kept for the property-map resolution below: the root's custom fields
  // come from this same payload, so mapping costs no extra Onshape call.
  let elementMetadata: unknown = null;
  try {
    elementMetadata = await onshape.client.getElementMetadata(
      document,
      elementId
    );
    rootPartNumber =
      metadataProperty(elementMetadata, "Part number") ?? rootPartNumber;
    rootName = metadataProperty(elementMetadata, "Name") ?? rootName;
    rootDescription =
      metadataProperty(elementMetadata, "Description") ?? rootDescription;
  } catch {
    // fall through to the 422 below when identity is missing
  }
  if (!rootPartNumber) {
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
    return data(
      {
        error:
          `This assembly has ${partNumbers.length} distinct parts, and one push handles up to ${MAX_PLAN_PARTS}. ` +
          (subAssemblies > 0
            ? `Push its ${subAssemblies} sub-assemblies from their own tabs first, then push this one — Carbon links each level to the one below it.`
            : "Split it into sub-assemblies in Onshape, push those first, then push this one.")
      },
      { status: 422 }
    );
  }

  // Every revision row, revision ascending, so the builder's pick per part
  // number is deterministic and apply can re-resolve the same way.
  const existing = await selectInBatches(partNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, name, description, type, defaultMethodType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  // Each batch is sorted within itself, so the concatenation is not. Re-sorted
  // to preserve the ascending order this read has always had — no consumer
  // depends on it today (every pick below compares revisions directly rather
  // than taking a position), but the reads document themselves as ordered and
  // a future reader should be able to rely on that.
  existing.data.sort((a, b) =>
    (a.revision ?? "").localeCompare(b.revision ?? "")
  );
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

  const serviceRole = getCarbonServiceRole();
  const [options, methodByItemId] = await Promise.all([
    loadPlanOptions(client, companyId),
    loadActiveMakeMethods(client, companyId, parentItemIds)
  ]);
  let ownership: Awaited<ReturnType<typeof loadMethodLineOwnership>>;
  try {
    ownership = await loadMethodLineOwnership(
      client,
      serviceRole,
      companyId,
      [...methodByItemId.values()].map((method) => method.id)
    );
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
    depth
  });

  // ---- Root custom fields (property map) ---------------------------------
  // The Onshape→custom-field map lives on the integration's settings
  // metadata (non-secret; getOnshapeClient read the same row but returns
  // only a client, so this is one more RLS-scoped select). Only the ROOT
  // item resolves fields — child items get theirs when their own part
  // studio is pushed — and only from the element metadata already fetched
  // above, so an unmapped company and a failed metadata read both cost
  // nothing extra.
  if (elementMetadata !== null) {
    const integration = await client
      .from("companyIntegration")
      .select("metadata")
      .eq("id", "onshape")
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
      // Optional keys ride along only when non-empty so a plan under an
      // empty map is byte-identical to one from before the feature.
      if (resolved.fields.length > 0) {
        plan.root.customFields = resolved.fields;
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
      { error: "Could not save the review; try again" },
      { status: 503 }
    );
  }

  return data(
    { planId: created.planId, expiresAt: created.expiresAt, plan },
    { headers: { "Cache-Control": "no-store" } }
  );
}
