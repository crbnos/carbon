import { requirePermissions } from "@carbon/auth/auth.server";
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

/**
 * Plan a release push: what pushing one Onshape release would do to Carbon,
 * for the panel to show before anything is written.
 *
 * Every Onshape read the push needs happens here — the document's revisions
 * (one call) and each released assembly's BOM at its released version (one
 * call per assembly) — and the BOM lines ride along in the stored plan, so
 * the apply route never returns to Onshape. Quota is what the old
 * single-request push cost, spent at review time instead. Carbon's side is
 * two bulk reads: every revision row for the release's part numbers and the
 * BOMs' level-1 children, and the active make methods of assemblies already
 * at the released letter (a released method refuses its BOM, and the review
 * must say so up front).
 *
 * Permissions match the apply route so a user who could not push finds out
 * before editing a review, not after.
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

  // ---- Carbon rows for the release's part numbers, and refused methods ----
  // Read before any BOM: an assembly already at its released letter whose
  // make method is released in Carbon refuses its BOM at apply, so its BOM
  // read would be quota spent on nothing. Ordered by revision so the
  // builder's fallbacks are deterministic.
  const releasePartNumbers = [
    ...new Set(modelItems.map((item) => item.partNumber))
  ];
  const releaseRows = await selectInBatches(releasePartNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, name, type, defaultMethodType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (releaseRows.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  // item.revision is nullable; the builder compares it to release letters as
  // a string and reads a missing one as "0", as plan-assembly does. Cast
  // straight through, a null default revision missed its own row and planned
  // a revision on top of it.
  const toPlanRow = <T extends { revision: string | null }>(row: T) => ({
    ...row,
    revision: row.revision ?? "0"
  });
  const items: PlanItemRow[] = releaseRows.data.map(toPlanRow);

  // Method status only matters for assemblies already at the released letter
  // (the reuse case): a released method refuses the BOM, and the review shows
  // that instead of discovering it at apply. Parts never consume it.
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
    // Settled so a failure answers 500 instead of reading as "no method",
    // which would plan a BOM read — and a BOM write — for a released method.
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

  // ---- BOMs at the released versions --------------------------------------
  // One read per released assembly the apply can act on, sequential as the
  // push always was (a burst of parallel BOM reads is how Onshape rate limits
  // bite). A BOM that will not read is a warning on the review, not a failed
  // plan: the rest of the release still plans, and the assembly is stored
  // with null lines, which the apply route treats as "leave the method
  // alone" — a transient Onshape failure at review time can never erase a
  // BOM at apply time. An empty array is a genuinely empty BOM.
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
        // Unreadable, so treated exactly like a failed read: null leaves the
        // method alone at apply, where an empty tree would clear it.
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

  // ---- Carbon rows for the BOMs' level-1 children --------------------------
  // A purchased child already in Carbon must be reused rather than re-minted;
  // only the numbers the first read did not cover are fetched.
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
        "id, readableId, revision, name, type, defaultMethodType, unitOfMeasureCode"
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

  // The stored copy carries the BOM lines apply walks; the response does not
  // (the review shows the plan's items and children, not raw BOM rows).
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
