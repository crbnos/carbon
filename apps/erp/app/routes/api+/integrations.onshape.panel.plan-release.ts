// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type {
  OnshapeBomNode,
  OnshapePropertyValue,
  PlanItemRow,
  PlanMappingContext
} from "@carbon/ee";
import {
  buildReleasePlan,
  drawingModels,
  groupRevisionsIntoReleases,
  isModelReleaseItem,
  missingBomColumnsMessage,
  parseBomTree,
  parseProperties,
  releaseBomKey,
  withoutProperties
} from "@carbon/ee";
import type { StoredReleasePlan } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadActiveMakeMethods,
  loadPlanMapping,
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
import { findOpenReleaseNotice } from "~/modules/settings/onshape-push.server";

export const config = {
  runtime: "nodejs"
};

const payloadSchema = z.object({
  documentId: z.string().min(1),
  releaseId: z.string().min(1)
});

/** Plan a release push without writing; the apply makes no Onshape call. */
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
  const { documentId, releaseId } = parsed.data;

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

  let revisions: Awaited<
    ReturnType<typeof onshape.client.getDocumentRevisions>
  >;
  try {
    revisions = await onshape.client.getDocumentRevisions(documentId);
  } catch (error) {
    const failure = onshapeFailure(error);
    return data(failure.body, { status: failure.status });
  }

  const release = groupRevisionsIntoReleases(revisions.items ?? []).find(
    (candidate) => candidate.releaseId === releaseId
  );
  if (!release) {
    return data(
      { error: "Release not found in this document" },
      { status: 404 }
    );
  }

  const modelItems = release.items.filter(isModelReleaseItem);
  const drawingItems = release.items.filter(
    (item) => !isModelReleaseItem(item)
  );
  if (modelItems.length === 0 && drawingItems.length === 0) {
    return data(
      { error: "The release contains no parts, assemblies or drawings" },
      { status: 422 }
    );
  }
  const releasePartNumbers = [
    ...new Set(modelItems.map((item) => item.partNumber))
  ];

  // A drawing numbered apart from its model is tied to it by the release
  // package, which lists the model under the drawing. Read only when needed.
  const warnings: string[] = [];
  let drawingModelByElementId: ReturnType<typeof drawingModels> = new Map();
  if (
    drawingItems.some((item) => !releasePartNumbers.includes(item.partNumber))
  ) {
    try {
      drawingModelByElementId = drawingModels(
        await onshape.client.getReleasePackageItems(releaseId)
      );
    } catch (error) {
      warnings.push(
        `The release package couldn't be read, so a drawing numbered apart from its model is not attached (${onshapeFailure(error).body.error})`
      );
    }
  }
  const drawingModelPartNumbers = [...drawingModelByElementId.values()]
    .map((model) => model.partNumber)
    .filter((partNumber) => !releasePartNumbers.includes(partNumber));

  // Read before any BOM: an assembly whose Carbon method is already released
  // refuses its BOM at apply, so reading that BOM wastes quota.
  const lookupPartNumbers = [
    ...new Set([...releasePartNumbers, ...drawingModelPartNumbers])
  ];
  const releaseRows = await selectInBatches(lookupPartNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, active, name, description, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode, sourcingType, mpn"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (releaseRows.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const toPlanRow = <T extends { revision: string | null }>(row: T) => ({
    ...row,
    revision: row.revision ?? "0"
  });
  const items: PlanItemRow[] = releaseRows.data.map(toPlanRow);

  const letterAssemblyItemIds = modelItems
    .filter((item) => item.elementType === 1)
    .flatMap((item) =>
      items
        .filter(
          (row) =>
            row.readableId === item.partNumber && row.revision === item.revision
        )
        .map((row) => row.id)
    );
  const [methods, options] = await Promise.all([
    loadActiveMakeMethods(client, companyId, letterAssemblyItemIds).then(
      (byItemId) => ({ byItemId, error: null }),
      (error: unknown) => ({ byItemId: null, error })
    ),
    loadPlanOptions(serviceRole, companyId)
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
  const refusedBomKeys = new Set(
    modelItems
      .filter((item) => item.elementType === 1)
      .filter((item) =>
        items.some(
          (row) =>
            row.readableId === item.partNumber &&
            row.revision === item.revision &&
            methodByItemId.get(row.id)?.status === "Active"
        )
      )
      .map(releaseBomKey)
  );

  // BOMs are read sequentially: parallel bursts hit Onshape rate limits. Null
  // lines (a failed read) tell the apply to leave the method alone; an empty
  // array is an empty BOM. Keyed by `releaseBomKey`: two configurations of one
  // element have two BOMs.
  const bomLinesByElementId: Record<string, OnshapeBomNode[] | null> = {};
  for (const item of modelItems) {
    if (item.elementType !== 1) continue;
    const bomKey = releaseBomKey(item);
    if (refusedBomKeys.has(bomKey)) {
      bomLinesByElementId[bomKey] = null;
      continue;
    }
    try {
      const bom = await onshape.client.getBillOfMaterialsIn(
        {
          documentId,
          wvm: OnshapeWVMType.VERSION,
          wvmId: item.versionId
        },
        item.elementId,
        item.configuration ?? null
      );
      const { lines, missingColumns } = parseBomTree(bom);
      if (missingColumns.length > 0) {
        bomLinesByElementId[bomKey] = null;
        warnings.push(
          `${item.partNumber} Rev ${item.revision}: ${missingBomColumnsMessage(
            missingColumns
          )}`
        );
        continue;
      }
      bomLinesByElementId[bomKey] = lines;
    } catch (error) {
      bomLinesByElementId[bomKey] = null;
      warnings.push(
        `${item.partNumber} Rev ${item.revision}: ${
          onshapeFailure(error, "bom").body.error
        }`
      );
    }
  }

  // Look up BOM children so bought parts already in Carbon are reused.
  const childPartNumbers = [
    ...new Set(
      Object.values(bomLinesByElementId)
        .flatMap((lines) => (lines ?? []).map((line) => line.partNumber))
        .filter(
          (partNumber): partNumber is string =>
            !!partNumber && !lookupPartNumbers.includes(partNumber)
        )
    )
  ];
  const childRows = await selectInBatches(childPartNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, active, name, description, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode, sourcingType, mpn"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (childRows.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  items.push(...childRows.data.map(toPlanRow));

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

  // Released items' properties at the released version, read sequentially:
  // one read per assembly, one per Part Studio version. BOM children carry
  // theirs on the BOM row.
  const propertiesByPartNumber = new Map<string, OnshapePropertyValue[]>();
  const needsProperties =
    mapping.map.length > 0 ||
    mapping.descriptionModes.name === "everyPush" ||
    mapping.descriptionModes.description === "everyPush";
  if (needsProperties) {
    const studios = new Map<string, typeof modelItems>();
    for (const item of modelItems) {
      if (item.elementType === 1) {
        try {
          const metadata = await onshape.client.getElementMetadata(
            {
              documentId,
              wvm: OnshapeWVMType.VERSION,
              wvmId: item.versionId
            },
            item.elementId,
            item.configuration ?? null
          );
          propertiesByPartNumber.set(
            item.partNumber,
            parseProperties(metadata)
          );
        } catch (error) {
          warnings.push(
            `${item.partNumber} Rev ${item.revision}: its Onshape properties couldn't be read, so no mapped value is written (${onshapeFailure(error).body.error})`
          );
        }
        continue;
      }
      if (!item.partId) continue;
      const key = `${item.elementId}:${item.versionId}:${item.configuration ?? ""}`;
      studios.set(key, [...(studios.get(key) ?? []), item]);
    }
    for (const studioItems of studios.values()) {
      const [first] = studioItems;
      if (!first) continue;
      try {
        const byPartId = await readPartProperties(
          onshape.client,
          { documentId, wvm: OnshapeWVMType.VERSION, wvmId: first.versionId },
          first.elementId,
          studioItems.flatMap((item) => (item.partId ? [item.partId] : [])),
          first.configuration ?? null
        );
        for (const item of studioItems) {
          const properties = item.partId ? byPartId.get(item.partId) : null;
          if (properties)
            propertiesByPartNumber.set(item.partNumber, properties);
        }
      } catch (error) {
        warnings.push(
          `${studioItems.map((item) => item.partNumber).join(", ")}: their Onshape properties couldn't be read, so no mapped value is written (${onshapeFailure(error).body.error})`
        );
      }
    }
  }

  const built = buildReleasePlan({
    documentId,
    release,
    items,
    bomLinesByElementId,
    methodByItemId,
    options,
    mapping,
    propertiesByPartNumber,
    drawingModelByElementId
  });
  // A release pushed from a second document adds to the first push's notice.
  const openNotice = built.changeNotice
    ? await findOpenReleaseNotice(client, companyId, built.releaseId)
    : { data: null, error: null };
  if (openNotice.error !== null) {
    return data(
      {
        error: `${openNotice.error}, so it can't tell which change notice to use. Try again.`
      },
      { status: 500 }
    );
  }
  const plan = openNotice.data
    ? { ...built, existingChangeNotice: openNotice.data.changeNoticeId }
    : built;

  // Only the stored copy carries the BOM lines the apply walks, minus cells.
  const stored: StoredReleasePlan = {
    ...plan,
    bomLinesByElementId: Object.fromEntries(
      Object.entries(bomLinesByElementId).map(([bomKey, lines]) => [
        bomKey,
        lines ? withoutProperties(lines) : null
      ])
    )
  };
  const saved = await createPanelPlan({ companyId, userId, plan: stored });
  if (!saved) {
    return data(
      { error: "Carbon couldn't save this review. Try again." },
      { status: 503 }
    );
  }

  return data(
    { planId: saved.planId, expiresAt: saved.expiresAt, plan, warnings },
    { headers: { "Cache-Control": "no-store" } }
  );
}
