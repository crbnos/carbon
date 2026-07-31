import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "integrations-onshape-item-sync");

// One generic answer for a part that does not exist and for a part belonging to
// another company: the RLS-scoped lookup cannot tell them apart, and neither may
// the response — a distinguishable answer would let valid ids be enumerated.
const PART_NOT_AVAILABLE = {
  error: "Part not found or you do not have permission to perform this action"
};

// POST: re-pull this part's released CAD from Onshape. Gated on the SAME
// configurable flag the jobs check (companyIntegration.metadata.assetSyncEnabled)
// so nothing can be pulled unless the company has turned Onshape asset sync on.
//
// The `queued` state rows are the record that a re-pull is in flight — they land
// before the event is fired, so the part page reads "queued" the moment the
// button is pressed. The model row is always queued; a drawing row is queued only
// when a previous sync left identifiers to re-export from, because this job
// discovers no new drawings (they release under their own part numbers).
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) {
    return data(PART_NOT_AVAILABLE, { status: 404 });
  }

  const integration = await client
    .from("companyIntegration")
    .select("active, metadata")
    .eq("companyId", companyId)
    .eq("id", "onshape")
    .single();

  if (integration.error || !integration.data?.active) {
    return data(
      { error: "Onshape integration not found or inactive" },
      { status: 400 }
    );
  }

  const metadata = (integration.data.metadata ?? {}) as Record<string, unknown>;
  if (metadata.assetSyncEnabled !== true) {
    return data(
      {
        error:
          "Onshape asset sync is disabled — enable it on the Onshape integration before pulling from Onshape"
      },
      { status: 400 }
    );
  }

  // Ownership check with the AUTHENTICATED client: RLS plus the companyId filter
  // decide whether this caller may act on this part at all.
  const item = await client
    .from("item")
    .select("id")
    .eq("companyId", companyId)
    .eq("id", itemId)
    .maybeSingle();

  if (item.error) {
    logger.error("Failed to read part for Onshape sync", { error: item.error });
    return data({ error: "Failed to start the Onshape sync" }, { status: 500 });
  }

  if (!item.data) {
    return data(PART_NOT_AVAILABLE, { status: 404 });
  }

  // Service role: `onshapeItemSyncState` is written only by routes and jobs, so
  // it has no INSERT/UPDATE policy. Every query filters companyId.
  const serviceRole = getCarbonServiceRole();
  const now = new Date().toISOString();

  const existingRows = await serviceRole
    .from("onshapeItemSyncState")
    .select("id, assetKind, documentId, versionId, elementId")
    .eq("companyId", companyId)
    .eq("itemId", itemId);

  if (existingRows.error) {
    logger.error("Failed to read Onshape sync state for part", {
      error: existingRows.error
    });
    return data({ error: "Failed to start the Onshape sync" }, { status: 500 });
  }

  const rows = existingRows.data ?? [];
  const modelRow = rows.find((row) => row.assetKind === "model");
  const drawingRow = rows.find((row) => row.assetKind === "drawing");
  // The drawing arm re-exports from persisted identifiers only, so a drawing row
  // without them is not part of this run and stays untouched.
  const drawingQueued = Boolean(
    drawingRow?.documentId && drawingRow.versionId && drawingRow.elementId
  );

  // `queued` marks a re-pull as started without erasing what the last sync
  // recorded — the identifiers and revision stay readable while the job runs,
  // and the job's own write replaces the full row when it finishes.
  const queuedColumns = {
    status: "queued",
    source: "manual",
    skipReason: null,
    error: null,
    observedOnly: false,
    updatedBy: userId,
    updatedAt: now
  };

  const queuedRowIds: string[] = [];

  if (modelRow) {
    const queuedModel = await serviceRole
      .from("onshapeItemSyncState")
      .update(queuedColumns)
      .eq("id", modelRow.id)
      .eq("companyId", companyId);
    if (queuedModel.error) {
      logger.error("Failed to queue Onshape model sync state", {
        error: queuedModel.error
      });
    } else {
      queuedRowIds.push(modelRow.id);
    }
  } else {
    const insertedModel = await serviceRole
      .from("onshapeItemSyncState")
      .insert({
        companyId,
        itemId,
        assetKind: "model",
        status: "queued",
        source: "manual",
        createdBy: userId
      })
      .select("id")
      .single();
    if (insertedModel.error || !insertedModel.data) {
      logger.error("Failed to create Onshape model sync state", {
        error: insertedModel.error
      });
    } else {
      queuedRowIds.push(insertedModel.data.id);
    }
  }

  if (drawingRow && drawingQueued) {
    const queuedDrawing = await serviceRole
      .from("onshapeItemSyncState")
      .update(queuedColumns)
      .eq("id", drawingRow.id)
      .eq("companyId", companyId);
    if (queuedDrawing.error) {
      logger.error("Failed to queue Onshape drawing sync state", {
        error: queuedDrawing.error
      });
    } else {
      queuedRowIds.push(drawingRow.id);
    }
  }

  try {
    await trigger("onshape-item-sync", { companyId, userId, itemId });
  } catch (triggerError) {
    logger.error("Failed to start the Onshape part sync", {
      error: triggerError
    });
    // The job never got queued, so nothing else will move these rows out of
    // `queued` — record the failure now rather than leaving a sync that looks
    // in flight until it reads stalled.
    if (queuedRowIds.length > 0) {
      await serviceRole
        .from("onshapeItemSyncState")
        .update({
          status: "failed",
          error: "Failed to queue the Onshape sync",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("companyId", companyId)
        .in("id", queuedRowIds);
    }

    return data({ error: "Failed to start the Onshape sync" }, { status: 500 });
  }

  return data({
    success: true,
    message: "Pulling the latest released CAD from Onshape"
  });
}
