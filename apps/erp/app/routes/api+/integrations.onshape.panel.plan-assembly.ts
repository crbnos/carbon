// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type {
  PlanItemRow,
  PlanMappingContext,
  StandardSources
} from "@carbon/ee";
import {
  assemblyAssetRows,
  buildAssemblyPlan,
  describeBomPayload,
  externalIdForAssembly,
  externalIdForBomLine,
  flattenNodes,
  identityValue,
  missingBomColumnsMessage,
  normalizeConfiguration,
  parseBomTree,
  parseProperties,
  rowDrawingKey,
  sourceLabel,
  withAssemblyDrawings,
  withCurrentFiles,
  withoutProperties
} from "@carbon/ee";
import type { OnshapeDocument, StoredAssemblyPlan } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadActiveMakeMethods,
  loadMethodLineOwnership,
  loadPlanMapping,
  loadPlanOptions,
  loadReleasedRevisions,
  loadReusableDrafts,
  loadStandardSources,
  ONSHAPE_V2_INTEGRATION_ID,
  OnshapeWVMType,
  onshapeFailure,
  readAssemblyDrawings,
  selectInBatches,
  withRefusedMethods
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { drawingFileKey, readCurrentFiles } from "@carbon/jobs/onshape-assets";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { loadMethodWriteRefusals } from "~/modules/settings/settings.service";
import { getDatabaseClient } from "~/services/database.server";

// The root's own part number and name as Onshape stores them, spaces kept.
const ROOT_TEXT = { trim: false };

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations-onshape-panel-plan-assembly");

const payloadSchema = z.object({
  documentId: z.string().min(1),
  wv: z.enum(["w", "v"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1),
  depth: z.enum(["all", "top"]).default("all"),
  configuration: z.string().nullish()
});

// Most distinct part numbers an `all` push plans: a push is one request with no
// rollback, and a gateway can cut a large one off mid-BOM.
const MAX_PLAN_PARTS = 1500;

// The panel stops waiting at 60 s. The drawing and file reads start only
// before this much has passed, so the review answers in time; what they did
// not reach shows as a warning.
const FILE_READS_BUDGET_MS = 45_000;

/** Plan an assembly push without writing; the apply reuses the stored plan. */
export async function action({ request }: ActionFunctionArgs) {
  const fileReadsDeadline = Date.now() + FILE_READS_BUDGET_MS;
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

  const serviceRole = getCarbonServiceRole();
  const onshape = await getOnshapeClient(
    serviceRole,
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

  let sources: StandardSources;
  try {
    sources = await loadStandardSources(serviceRole, companyId);
  } catch (error) {
    logger.error("Failed to read the Onshape property map", {
      companyId,
      error
    });
    return data(
      { error: "Failed to read the Onshape property map" },
      { status: 500 }
    );
  }

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

  // Element metadata names the assembly; the BOM's top row is the fallback.
  const { root: bomRoot, lines, missingColumns } = parseBomTree(bom, sources);
  // An empty plan from an unreadable tree would drop every Onshape line.
  if (missingColumns.length > 0) {
    const diagnostics = {
      request: { documentId, wv, wvId, elementId, configuration, depth },
      onshapeApi: onshape.client.apiOrigin,
      missingColumns,
      bom: describeBomPayload(bom)
    };
    logger.warn("Onshape BOM is missing required columns", {
      companyId,
      ...diagnostics
    });
    return data(
      { error: missingBomColumnsMessage(missingColumns), diagnostics },
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
    const properties = parseProperties(elementMetadata);
    rootPartNumber =
      identityValue(properties, "partNumber", sources, ROOT_TEXT) ??
      rootPartNumber;
    rootName =
      identityValue(properties, "name", sources, ROOT_TEXT) ?? rootName;
    rootDescription =
      identityValue(properties, "description", sources, ROOT_TEXT) ??
      rootDescription;
  } catch (error) {
    metadataError = error;
  }
  if (!rootPartNumber) {
    if (metadataError !== null) {
      const failure = onshapeFailure(metadataError);
      return data(failure.body, { status: failure.status });
    }
    return data(
      {
        error: sources.identity.partNumber
          ? `Set ${sourceLabel("partNumber", sources)} on the assembly in Onshape first: it is the part number`
          : "Set a part number on the assembly in Onshape first"
      },
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
    // Counts the whole tree, so pushing sub-assemblies first does not help;
    // `code` lets the panel offer `top`.
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
        "id, readableId, revision, revisionStatus, active, name, description, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode, sourcingType, mpn"
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
  const revisionStatusByItemId = new Map(
    existing.data.map((row) => [row.id, row.revisionStatus])
  );

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

  const [options, methods, links, itemLinks] = await Promise.all([
    loadPlanOptions(serviceRole, companyId),
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
    // An item linked elsewhere keeps its link and takes no mapped values.
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

  let mapping: PlanMappingContext;
  try {
    mapping = await loadPlanMapping(
      serviceRole,
      companyId,
      items.map((item) => item.readableId)
    );
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the Onshape property map"
      },
      { status: 500 }
    );
  }
  // The root's mapped values come from its element metadata.
  if (mapping.map.length > 0 && elementMetadata === null && metadataError) {
    const failure = onshapeFailure(metadataError);
    return data(failure.body, { status: failure.status });
  }

  let released: Awaited<ReturnType<typeof loadReleasedRevisions>>;
  try {
    released = await loadReleasedRevisions(client, companyId, items);
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error ? error.message : "Failed to read Carbon items"
      },
      { status: 500 }
    );
  }

  // The review lists a BOM the push will not write: a change notice's Draft, or
  // a locked released revision. Apply checks again.
  const refusals = await loadMethodWriteRefusals(
    client,
    companyId,
    [...methodByItemId.entries()].map(([itemId, method]) => ({
      itemId,
      method,
      revisionStatus: revisionStatusByItemId.get(itemId)
    }))
  );

  const built = buildAssemblyPlan({
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
    reusableDraftByItemId,
    mapping,
    rootProperties:
      elementMetadata !== null ? parseProperties(elementMetadata) : null,
    released
  });
  const refused = withRefusedMethods(built, refusals);

  // The drawings each row can take, so the review can offer them. A failed
  // read leaves those rows without drawings and says so.
  const drawings = await readAssemblyDrawings({
    client: onshape.client,
    companyId,
    plan: refused,
    nodes: lines,
    deadline: fileReadsDeadline
  });
  const fileWarnings = [...drawings.warnings];
  const placed = withAssemblyDrawings(refused, drawings.tied);

  // The files the rows' items already have from the current state: the push
  // skips them, so the review marks them and does not count them. The root's
  // own model goes with every push, so it is checked too.
  const itemIdByPartNumber = new Map<string, string | null>([
    [refused.root.partNumber, refused.root.itemId],
    ...refused.items.map((item) => [item.partNumber, item.itemId] as const)
  ]);
  const rows = assemblyAssetRows({
    plan: placed.plan,
    ties: placed.ties,
    itemIdFor: (partNumber) => itemIdByPartNumber.get(partNumber) ?? null
  });
  const rootItemId =
    refused.root.itemId && !refused.root.released ? refused.root.itemId : null;
  const rootModelRow = rootItemId
    ? [
        {
          kind: "assembly" as const,
          documentId,
          wvm: wv,
          wvmId: wvId,
          elementId,
          configuration,
          itemId: rootItemId,
          partNumber: refused.root.partNumber
        }
      ]
    : [];
  const none = new Set<string>();
  let current = {
    models: none,
    drawings: none,
    outOfDate: { models: none, drawings: none },
    rootModel: false
  };
  try {
    const found = await readCurrentFiles({
      client: onshape.client,
      carbon: serviceRole,
      db: getDatabaseClient(),
      companyId,
      rows: { ...rows, models: [...rows.models, ...rootModelRow] },
      deadline: fileReadsDeadline,
      read: async (label, read) => {
        try {
          return await read();
        } catch (error) {
          logger.warn("Onshape state read failed", { companyId, label, error });
          return null;
        }
      }
    });
    const modelPartNumbers = (itemIds: string[]) => {
      const held = new Set(itemIds);
      return new Set(
        rows.models
          .filter((row) => held.has(row.itemId))
          .map((row) => row.partNumber)
      );
    };
    const drawingKeys = (fileKeys: string[]) => {
      const held = new Set(fileKeys);
      return new Set(
        rows.drawings
          .filter((row) => held.has(drawingFileKey(row)))
          .map((row) => rowDrawingKey(row.partNumber, row.drawingElementId))
      );
    };
    current = {
      models: modelPartNumbers(found.models),
      drawings: drawingKeys(found.drawings),
      outOfDate: {
        models: modelPartNumbers(found.outOfDate.models),
        drawings: drawingKeys(found.outOfDate.drawings)
      },
      rootModel: rootItemId !== null && found.models.includes(rootItemId)
    };
    if (found.unread > 0) {
      fileWarnings.push(
        found.unread === 1
          ? "Carbon couldn't check whether the files from 1 source document are current, so they count as exports here. The export still skips any that are."
          : `Carbon couldn't check whether the files from ${found.unread} source documents are current, so they count as exports here. The export still skips any that are.`
      );
    }
  } catch (error) {
    logger.warn("Current file check failed", { companyId, error });
    fileWarnings.push(
      "Carbon couldn't check which files the items already have, so every pick counts as an export."
    );
  }

  const plan = withCurrentFiles(
    {
      ...placed.plan,
      ...(fileWarnings.length > 0 ? { fileWarnings } : {})
    },
    current
  );

  // The apply walks the stored BOM structure; the property cells are dropped.
  // The panel gets each drawing's name; the stored plan keeps the ties.
  const stored: StoredAssemblyPlan = {
    ...plan,
    nodes: withoutProperties(lines),
    drawingTies: placed.ties
  };
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
