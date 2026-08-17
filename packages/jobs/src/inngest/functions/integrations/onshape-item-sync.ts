import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { OnshapeRevision } from "@carbon/ee/onshape";
import {
  getOnshapeClient,
  OnshapeAssetTooLargeError
} from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { inngest } from "../../client";
import {
  isOnshapeAssetSyncEnabled,
  resolveOnshapeCompanyId,
  withRateLimitRetry
} from "./onshape-backfill";
import {
  drawingIdentifiersFromState,
  itemReleaseKey,
  selectRevisionForItem
} from "./onshape-matching";
import {
  syncOnshapeDrawingAssetsToItem,
  syncOnshapeElementAssetsToItem
} from "./onshape-sync-element";
import {
  markItemSyncStateFailedByItem,
  upsertItemSyncState
} from "./onshape-sync-state";

// Per-item re-pull: one Carbon item -> re-export the released Onshape assets it
// should carry, on demand. LINK-ONLY like the other two triggers (never creates
// items), and unlike them it starts from the ITEM rather than from a release, so
// the item is known before any Onshape call and every outcome is attributable to
// it.
//
// MODEL arm: the item's part number + revision letter are the query. Onshape's
// per-part revisions endpoint lists that part's releases, and the release whose
// letter matches the item's revision is the one to export.
//
// DRAWING arm: drawings release under their OWN part numbers (DRW-xxxx documents
// PRT-xxxx), so the per-part revisions endpoint could never find one from the
// item's part number. This job therefore re-exports a drawing ONLY from the
// identifiers a previous sync persisted on the item's drawing state row, and
// discovers nothing: a drawing this item has never had reaches it via the
// release webhook or the backfill, both of which scan releases company-wide.

type CarbonClient = SupabaseClient<Database>;

// Onshape elementType is NUMERIC: 0 = Part Studio, 1 = Assembly, 2 = Drawing.
// Only the first two carry a model, and the per-part revisions endpoint filters
// by one type per call — so the model arm asks for both.
const MODEL_ELEMENT_TYPES = [0, 1];

// Every revision the selection keeps survived the isObsolete filter, so the
// release state recorded for it is Onshape's released state.
const RELEASED_STATE = "Released";

// The item fields the re-pull needs: the match key for the model arm, plus the
// filename base the attach helper stamps on the exported asset.
export interface OnshapeSyncItem {
  id: string;
  readableId: string;
  revision: string | null;
  readableIdWithRevision: string | null;
  modelUploadId: string | null;
}

// --- Steps ------------------------------------------------------------------

export interface OnshapeItemSyncInput {
  companyId: string;
  userId: string; // the user who asked for the re-pull (auth + audit)
  itemId: string;
}

export async function loadItemForSync(
  carbon: CarbonClient,
  input: Pick<OnshapeItemSyncInput, "companyId" | "itemId">
): Promise<OnshapeSyncItem | null> {
  const item = await carbon
    .from("item")
    .select("id, readableId, revision, readableIdWithRevision, modelUploadId")
    .eq("companyId", input.companyId)
    .eq("id", input.itemId)
    .maybeSingle();
  if (item.error) {
    throw new Error(
      `loadItemForSync: item query failed: ${item.error.message}`
    );
  }
  return item.data ?? null;
}

export interface OnshapeItemModelSyncOutcome {
  status: "synced" | "skipped";
  skipReason?: "revision-not-found" | "asset-too-large";
  revision?: string;
  releaseState?: string;
  documentId?: string;
  versionId?: string;
  elementId?: string;
  modelUploadId?: string | null;
  thumbnailAttached?: boolean;
}

// MODEL arm, run as one memoized step: list the part's releases, pick this
// item's revision, export + attach it, and record the outcome on the item's
// model state row. The state write lives inside the step (best-effort via the
// helper) so bookkeeping can neither replay nor turn a finished export into a
// retry.
export async function syncOnshapeItemModel(
  carbon: CarbonClient,
  input: OnshapeItemSyncInput & {
    onshapeCompanyId: string;
    item: OnshapeSyncItem;
  }
): Promise<OnshapeItemModelSyncOutcome> {
  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(
      `syncOnshapeItemModel: getOnshapeClient failed: ${
        onshape.error ?? "no client"
      }`
    );
  }
  const client = onshape.client;

  const partNumber = input.item.readableId;
  const revisions: OnshapeRevision[] = [];
  for (const elementType of MODEL_ELEMENT_TYPES) {
    const page = await withRateLimitRetry(
      () =>
        client.getRevisions(input.onshapeCompanyId, partNumber, elementType),
      `revisions ${partNumber} type ${elementType}`
    );
    revisions.push(...(page.items ?? []));
  }

  const released = selectRevisionForItem(revisions, input.item);
  if (!released) {
    await upsertItemSyncState(carbon, {
      companyId: input.companyId,
      userId: input.userId,
      itemId: input.item.id,
      assetKind: "model",
      status: "skipped",
      source: "manual",
      skipReason: "revision-not-found",
      partNumber,
      revision: input.item.revision
    });
    return { status: "skipped", skipReason: "revision-not-found" };
  }

  const assetBaseName = itemReleaseKey(input.item);
  try {
    const attached = await withRateLimitRetry(
      () =>
        syncOnshapeElementAssetsToItem(carbon, {
          companyId: input.companyId,
          userId: input.userId,
          itemId: input.item.id,
          sourceDocument: "Part",
          documentId: released.documentId,
          versionId: released.versionId,
          modelElementId: released.elementId,
          modelElementKind:
            released.elementType === 1 ? "assembly" : "partstudio",
          assetBaseName
        }),
      `model ${partNumber} rev ${released.revision}`
    );
    await upsertItemSyncState(carbon, {
      companyId: input.companyId,
      userId: input.userId,
      itemId: input.item.id,
      assetKind: "model",
      status: "synced",
      source: "manual",
      partNumber: released.partNumber,
      revision: released.revision,
      releaseState: RELEASED_STATE,
      documentId: released.documentId,
      versionId: released.versionId,
      elementId: released.elementId,
      modelUploadId: attached.modelUploadId
    });
    return {
      status: "synced",
      revision: released.revision,
      releaseState: RELEASED_STATE,
      documentId: released.documentId,
      versionId: released.versionId,
      elementId: released.elementId,
      modelUploadId: attached.modelUploadId,
      thumbnailAttached: attached.thumbnailAttached
    };
  } catch (syncError) {
    if (syncError instanceof OnshapeAssetTooLargeError) {
      // Permanent: a retry can't shrink the export. Skip, don't fail.
      console.warn(
        `syncOnshapeItemModel: skipping oversized model ${partNumber}: ${syncError.message}`
      );
      await upsertItemSyncState(carbon, {
        companyId: input.companyId,
        userId: input.userId,
        itemId: input.item.id,
        assetKind: "model",
        status: "skipped",
        source: "manual",
        skipReason: "asset-too-large",
        partNumber: released.partNumber,
        revision: released.revision,
        releaseState: RELEASED_STATE,
        documentId: released.documentId,
        versionId: released.versionId,
        elementId: released.elementId
      });
      return {
        status: "skipped",
        skipReason: "asset-too-large",
        revision: released.revision,
        releaseState: RELEASED_STATE
      };
    }
    // Anything else is retryable — Inngest retries the step, and the run's
    // onFailure is what records a terminal failure on the item's row.
    throw syncError;
  }
}

export interface OnshapeItemDrawingSyncOutcome {
  /** `not-attempted`: no drawing has ever been synced for this item. */
  status: "synced" | "skipped" | "not-attempted";
  skipReason?: "asset-too-large";
  revision?: string | null;
}

// DRAWING arm, run as one memoized step. Bounded by design to what a previous
// sync already resolved: with identifiers it re-exports the same drawing element
// and updates the row; without them it touches nothing at all (no row is created
// here, so an item that has never had a drawing keeps reading as never-synced).
export async function syncOnshapeItemDrawing(
  carbon: CarbonClient,
  input: OnshapeItemSyncInput & { item: OnshapeSyncItem }
): Promise<OnshapeItemDrawingSyncOutcome> {
  const stateRow = await carbon
    .from("onshapeItemSyncState")
    .select(
      "documentId, versionId, elementId, partNumber, revision, releaseState"
    )
    .eq("companyId", input.companyId)
    .eq("itemId", input.item.id)
    .eq("assetKind", "drawing")
    .maybeSingle();
  if (stateRow.error) {
    throw new Error(
      `syncOnshapeItemDrawing: drawing state query failed: ${stateRow.error.message}`
    );
  }

  const identifiers = drawingIdentifiersFromState(stateRow.data);
  if (!identifiers) {
    return { status: "not-attempted" };
  }

  const label = `drawing ${identifiers.partNumber ?? input.item.readableId}`;
  try {
    await withRateLimitRetry(
      () =>
        syncOnshapeDrawingAssetsToItem(carbon, {
          companyId: input.companyId,
          userId: input.userId,
          itemId: input.item.id,
          sourceDocument: "Part",
          documentId: identifiers.documentId,
          versionId: identifiers.versionId,
          drawingElementId: identifiers.elementId,
          assetBaseName: itemReleaseKey(input.item)
        }),
      label
    );
    await upsertItemSyncState(carbon, {
      companyId: input.companyId,
      userId: input.userId,
      itemId: input.item.id,
      assetKind: "drawing",
      status: "synced",
      source: "manual",
      partNumber: identifiers.partNumber,
      revision: identifiers.revision,
      releaseState: identifiers.releaseState,
      documentId: identifiers.documentId,
      versionId: identifiers.versionId,
      elementId: identifiers.elementId
    });
    return { status: "synced", revision: identifiers.revision };
  } catch (syncError) {
    if (syncError instanceof OnshapeAssetTooLargeError) {
      console.warn(
        `syncOnshapeItemDrawing: skipping oversized ${label}: ${syncError.message}`
      );
      await upsertItemSyncState(carbon, {
        companyId: input.companyId,
        userId: input.userId,
        itemId: input.item.id,
        assetKind: "drawing",
        status: "skipped",
        source: "manual",
        skipReason: "asset-too-large",
        partNumber: identifiers.partNumber,
        revision: identifiers.revision,
        releaseState: identifiers.releaseState,
        documentId: identifiers.documentId,
        versionId: identifiers.versionId,
        elementId: identifiers.elementId
      });
      return {
        status: "skipped",
        skipReason: "asset-too-large",
        revision: identifiers.revision
      };
    }
    throw syncError;
  }
}

// --- Inngest function -------------------------------------------------------
// CONFIGURABLE: like the other two Onshape asset triggers it runs only while the
// company has asset sync on and the integration active. Fired from the part page
// via trigger("onshape-item-sync", { companyId, userId, itemId }); the route
// records the `queued` state rows before firing.

const OnshapeItemSyncPayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  itemId: z.string()
});

type OnshapeItemSyncPayload = z.infer<typeof OnshapeItemSyncPayloadSchema>;

export const onshapeItemSyncFunction = inngest.createFunction(
  {
    id: "onshape-item-sync",
    retries: 3,
    // One re-pull per item at a time, so a double-click can't run two exports
    // against the same item; different items run in parallel.
    concurrency: { key: "event.data.itemId", limit: 1 },
    // A run that exhausted its retries records the failure on this item's rows.
    // The item is known from the event, so the failure is attributed by item +
    // asset kind rather than by released element.
    onFailure: async ({ event }) => {
      const { companyId, userId, itemId } = event.data.event
        .data as OnshapeItemSyncPayload;
      const carbon = getCarbonServiceRole();
      const errorMessage = event.data.error.message;
      // Both arms only claim a row the route moved to `queued` for THIS re-pull:
      // one arm can succeed and the other throw, so a row in any other state
      // belongs to an earlier, completed sync and keeps its own outcome rather
      // than inheriting the other arm's error.
      await markItemSyncStateFailedByItem(carbon, {
        companyId,
        userId,
        itemId,
        assetKind: "model",
        error: errorMessage,
        onlyFromStatuses: ["queued", "running"]
      });
      await markItemSyncStateFailedByItem(carbon, {
        companyId,
        userId,
        itemId,
        assetKind: "drawing",
        error: errorMessage,
        onlyFromStatuses: ["queued", "running"]
      });
    }
  },
  { event: "carbon/onshape-item-sync" },
  async ({ event, step }) => {
    const payload = OnshapeItemSyncPayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    // Runs on every execution (not inside a step) so flipping the toggle off
    // also kills an in-flight retry.
    if (!(await isOnshapeAssetSyncEnabled(carbon, payload.companyId))) {
      console.log("onshape-item-sync: skipped (disabled or inactive)", {
        companyId: payload.companyId,
        itemId: payload.itemId
      });
      return { skipped: true as const };
    }

    const item = await step.run("load-item", () =>
      loadItemForSync(carbon, payload)
    );
    if (!item) {
      // The item was deleted between the click and this run. There is no entity
      // left to own an outcome, so nothing is written — not even a skip.
      console.log("onshape-item-sync: item no longer exists", {
        companyId: payload.companyId,
        itemId: payload.itemId
      });
      return { skipped: true as const };
    }

    const onshapeCompanyId = await step.run("resolve-onshape-company", () =>
      resolveOnshapeCompanyId(carbon, payload)
    );

    const model = await step.run("sync-model", () =>
      syncOnshapeItemModel(carbon, { ...payload, onshapeCompanyId, item })
    );

    const drawing = await step.run("sync-drawing", () =>
      syncOnshapeItemDrawing(carbon, { ...payload, item })
    );

    if (model.status === "synced" && model.modelUploadId) {
      // The sync stores the RAW Onshape export; the assembler turns it into the
      // meshopt-compressed viewer GLB (same event the manual upload route fires).
      await step.sendEvent("model-optimize", {
        name: "carbon/model-optimize" as const,
        data: {
          modelUploadId: model.modelUploadId,
          companyId: payload.companyId,
          userId: payload.userId
        }
      });
    }

    if (
      model.status === "synced" &&
      model.modelUploadId &&
      !model.thumbnailAttached
    ) {
      // Fallback only: the sync stores Onshape's server-rendered thumbnail
      // itself; the screenshot pipeline runs just when that fetch failed.
      await step.sendEvent("model-thumbnail", {
        name: "carbon/model-thumbnail" as const,
        data: { companyId: payload.companyId, modelId: model.modelUploadId }
      });
    }

    return { itemId: item.id, model, drawing };
  }
);
