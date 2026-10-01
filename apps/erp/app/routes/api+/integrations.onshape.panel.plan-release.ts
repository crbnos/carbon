// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OnshapeBomNode, PlanItemRow } from "@carbon/ee";
import {
  buildReleasePlan,
  groupRevisionsIntoReleases,
  isModelReleaseItem,
  missingBomColumnsMessage,
  parseBomTree
} from "@carbon/ee";
import type { StoredReleasePlan } from "@carbon/ee/onshape";
import {
  createPanelPlan,
  getOnshapeClient,
  loadActiveMakeMethods,
  loadPlanOptions,
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
  releaseId: z.string().min(1)
});

/** Plan a release push without writing; the apply makes no Onshape call. */
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
  const { documentId, releaseId } = parsed.data;

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
  if (modelItems.length === 0) {
    return data(
      { error: "The release contains no parts or assemblies" },
      { status: 422 }
    );
  }

  // Read before any BOM: an assembly whose Carbon method is already released
  // refuses its BOM at apply, so reading that BOM wastes quota.
  const releasePartNumbers = [
    ...new Set(modelItems.map((item) => item.partNumber))
  ];
  const releaseRows = await selectInBatches(releasePartNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, active, name, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (releaseRows.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  // A null revision reads as "0", as in plan-assembly.
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
    // A failure must answer 500, not read as "no method": that would plan a
    // BOM write over a released method.
    loadActiveMakeMethods(client, companyId, letterAssemblyItemIds).then(
      (byItemId) => ({ byItemId, error: null }),
      (error: unknown) => ({ byItemId: null, error })
    ),
    loadPlanOptions(client, companyId)
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
  const refusedElementIds = new Set(
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
      .map((item) => item.elementId)
  );

  // BOMs are read sequentially: parallel bursts hit Onshape rate limits. A
  // failed read stores null lines, which apply treats as "leave the method
  // alone"; an empty array is a genuinely empty BOM.
  const bomLinesByElementId: Record<string, OnshapeBomNode[] | null> = {};
  const warnings: string[] = [];
  for (const item of modelItems) {
    if (item.elementType !== 1) continue;
    if (refusedElementIds.has(item.elementId)) {
      bomLinesByElementId[item.elementId] = null;
      continue;
    }
    try {
      const bom = await onshape.client.getBillOfMaterialsIn(
        {
          documentId,
          wvm: OnshapeWVMType.VERSION,
          wvmId: item.versionId
        },
        item.elementId
      );
      const { lines, missingColumns } = parseBomTree(bom);
      if (missingColumns.length > 0) {
        bomLinesByElementId[item.elementId] = null;
        warnings.push(
          `${item.partNumber} Rev ${item.revision}: ${missingBomColumnsMessage(
            missingColumns
          )}`
        );
        continue;
      }
      bomLinesByElementId[item.elementId] = lines;
    } catch (error) {
      bomLinesByElementId[item.elementId] = null;
      warnings.push(
        `${item.partNumber} Rev ${item.revision}: ${
          onshapeFailure(error, "bom").body.error
        }`
      );
    }
  }

  // Look up BOM children so purchased parts already in Carbon are reused.
  const childPartNumbers = [
    ...new Set(
      Object.values(bomLinesByElementId)
        .flatMap((lines) => (lines ?? []).map((line) => line.partNumber))
        .filter(
          (partNumber): partNumber is string =>
            !!partNumber && !releasePartNumbers.includes(partNumber)
        )
    )
  ];
  const childRows = await selectInBatches(childPartNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, active, name, type, replenishmentSystem, defaultMethodType, itemTrackingType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (childRows.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  items.push(...childRows.data.map(toPlanRow));

  const plan = buildReleasePlan({
    documentId,
    release,
    items,
    bomLinesByElementId,
    methodByItemId,
    options
  });

  // Only the stored copy carries the BOM lines the apply walks.
  const stored: StoredReleasePlan = { ...plan, bomLinesByElementId };
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
