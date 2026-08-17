import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
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
  escapeLikePattern,
  releaseKey,
  sharedNumberSuffix
} from "./onshape-matching";
import {
  syncOnshapeDrawingAssetsToItem,
  syncOnshapeElementAssetsToItem
} from "./onshape-sync-element";
import {
  markItemSyncStateFailedByElement,
  type OnshapeSyncAssetKind,
  upsertItemSyncState
} from "./onshape-sync-state";

// Go-forward sync: one released Onshape revision ->
// attach its CAD model to the matching Carbon item. LINK-ONLY (never creates
// items). Driven by the onshape.revision.created webhook, which — unlike
// workflow.transition — carries everything the sync core needs: documentId,
// versionId, elementId, elementType (0/1/2), and partNumber.
//
// The one thing the event does NOT carry is the revision LETTER (e.g. "A2"); it
// gives a revisionId. Carbon's readableIdWithRevision match key needs the letter,
// so we resolve it from the per-part revisions API by matching the released
// version/element back to its revision.

type CarbonClient = SupabaseClient<Database>;

export interface OnshapeRevisionSyncInput {
  companyId: string; // Carbon company
  userId: string; // Onshape integration installer (auth + audit)
  partNumber: string;
  documentId: string;
  versionId: string;
  elementId: string;
  elementType: number; // 0 = part studio, 1 = assembly, 2 = drawing
  revisionId?: string;
  onshapeCompanyId?: string; // resolved via getCompanies if omitted
}

export interface OnshapeRevisionSyncResult {
  synced: boolean;
  skippedReason?:
    | "unknown-element"
    | "no-matching-item"
    | "ambiguous-item"
    | "revision-not-found"
    | "asset-too-large"; // export exceeds Carbon's upload limits — permanent skip
  itemId?: string;
  modelUploadId?: string | null;
  thumbnailAttached?: boolean; // Onshape-rendered thumbnail stored — no fallback event needed
  releaseKey?: string;
  revision?: string; // the resolved revision LETTER (the event only carries an id)
  releaseState?: string; // what Onshape reports for the resolved revision
}

// Onshape elementType is NUMERIC: 0 = Part Studio, 1 = Assembly, 2 = Drawing.
function modelKindForElementType(
  elementType: number
): "partstudio" | "assembly" | null {
  if (elementType === 1) return "assembly";
  if (elementType === 0) return "partstudio";
  return null;
}

export async function runOnshapeRevisionSync(
  carbon: CarbonClient,
  input: OnshapeRevisionSyncInput
): Promise<OnshapeRevisionSyncResult> {
  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(
      `runOnshapeRevisionSync: getOnshapeClient failed: ${
        onshape.error ?? "no client"
      }`
    );
  }
  const client = onshape.client;

  const onshapeCompanyId =
    input.onshapeCompanyId ?? (await resolveOnshapeCompanyId(carbon, input));

  // Resolve the revision LETTER for this released element. Prefer the revision
  // whose version + element match this event exactly; fall back to version match.
  const revisions = await client.getRevisions(
    onshapeCompanyId,
    input.partNumber,
    input.elementType
  );
  const revisionList = revisions.items ?? [];
  const releasedRevision =
    revisionList.find(
      (revision) =>
        revision.versionId === input.versionId &&
        revision.elementId === input.elementId
    ) ??
    revisionList.find((revision) => revision.versionId === input.versionId);

  if (!releasedRevision) {
    return { synced: false, skippedReason: "revision-not-found" };
  }
  const revision = releasedRevision.revision;
  // The only release-state signal the revisions API carries: a revision that is
  // not obsolete is the released one for its part.
  const releaseState = releasedRevision.isObsolete ? "Obsolete" : "Released";

  // DRAWING (elementType 2): released as its own DRW-xxxx element. Export it as a
  // PDF and attach it to the MODEL item sharing its number (PRT-xxxx / ASM-xxxx)
  // at the same revision — never create a DRW-xxxx item.
  if (input.elementType === 2) {
    const suffix = sharedNumberSuffix(input.partNumber);
    if (suffix.length < 2) {
      return { synced: false, skippedReason: "no-matching-item" };
    }
    // Match any model item ending in the shared number at this revision. The
    // leading separator in `suffix` (e.g. "-002033") anchors it so "-002033"
    // doesn't match "-1002033"; LIKE wildcards in the part number are escaped
    // so they match literally.
    const candidates = await carbon
      .from("item")
      .select("id, readableIdWithRevision")
      .eq("companyId", input.companyId)
      .eq("revision", revision)
      .ilike("readableId", `%${escapeLikePattern(suffix)}`);
    if (candidates.error) {
      throw new Error(
        `runOnshapeRevisionSync: drawing item match query failed: ${candidates.error.message}`
      );
    }
    const items = candidates.data ?? [];
    if (items.length === 0) {
      return {
        synced: false,
        skippedReason: "no-matching-item",
        releaseKey: releaseKey(input.partNumber, revision)
      };
    }
    if (items.length > 1) {
      // Multiple models share this number + revision — can't safely pick one.
      return { synced: false, skippedReason: "ambiguous-item" };
    }
    const target = items[0];
    if (!target) {
      return { synced: false, skippedReason: "no-matching-item" };
    }
    try {
      const attached = await syncOnshapeDrawingAssetsToItem(carbon, {
        companyId: input.companyId,
        userId: input.userId,
        itemId: target.id,
        sourceDocument: "Part",
        documentId: input.documentId,
        versionId: input.versionId,
        drawingElementId: input.elementId,
        assetBaseName: target.readableIdWithRevision ?? undefined
      });
      return {
        synced: true,
        itemId: target.id,
        modelUploadId: attached.modelUploadId,
        releaseKey: target.readableIdWithRevision ?? undefined,
        revision,
        releaseState
      };
    } catch (syncError) {
      if (syncError instanceof OnshapeAssetTooLargeError) {
        // Permanent: a retry can't shrink the export. Skip, don't fail.
        console.warn(
          `runOnshapeRevisionSync: skipping oversized drawing ${input.partNumber}: ${syncError.message}`
        );
        return {
          synced: false,
          skippedReason: "asset-too-large",
          itemId: target.id,
          revision,
          releaseState
        };
      }
      throw syncError;
    }
  }

  // MODEL (elementType 0 = part studio, 1 = assembly): export compressed GLB + attach.
  const modelElementKind = modelKindForElementType(input.elementType);
  if (!modelElementKind) {
    return { synced: false, skippedReason: "unknown-element" };
  }

  const key = releaseKey(input.partNumber, revision);

  // LINK-ONLY: attach only to an item that already exists. No match => skip.
  const carbonItem = await carbon
    .from("item")
    .select("id")
    .eq("companyId", input.companyId)
    .eq("readableIdWithRevision", key)
    .maybeSingle();
  if (carbonItem.error) {
    throw new Error(
      `runOnshapeRevisionSync: item match query failed: ${carbonItem.error.message}`
    );
  }
  if (!carbonItem.data) {
    return {
      synced: false,
      skippedReason: "no-matching-item",
      releaseKey: key
    };
  }

  let attached: Awaited<ReturnType<typeof syncOnshapeElementAssetsToItem>>;
  try {
    attached = await syncOnshapeElementAssetsToItem(carbon, {
      companyId: input.companyId,
      userId: input.userId,
      itemId: carbonItem.data.id,
      sourceDocument: "Part", // v1: released items are parts/assemblies
      documentId: input.documentId,
      versionId: input.versionId,
      modelElementId: input.elementId,
      modelElementKind,
      assetBaseName: key
    });
  } catch (syncError) {
    if (syncError instanceof OnshapeAssetTooLargeError) {
      // Permanent: a retry can't shrink the export. Skip, don't fail. The
      // drawing PDF (a separate DRW element/event) still attaches normally.
      console.warn(
        `runOnshapeRevisionSync: skipping oversized model ${key}: ${syncError.message}`
      );
      return {
        synced: false,
        skippedReason: "asset-too-large",
        releaseKey: key,
        itemId: carbonItem.data.id,
        revision,
        releaseState
      };
    }
    throw syncError;
  }

  return {
    synced: true,
    itemId: carbonItem.data.id,
    modelUploadId: attached.modelUploadId,
    thumbnailAttached: attached.thumbnailAttached,
    releaseKey: key,
    revision,
    releaseState
  };
}

// --- Inngest function -------------------------------------------------------
// CONFIGURABLE + idempotent. Runs only when the company enabled Onshape asset
// sync (companyIntegration.metadata.assetSyncEnabled === true) and the
// integration is active. Deduped on the Onshape webhook messageId so a
// re-delivery doesn't re-export/re-attach. Fired from the webhook receiver via
// trigger("onshape-revision-sync", { ... }).

const OnshapeRevisionSyncPayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  messageId: z.string(),
  partNumber: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  elementId: z.string(),
  elementType: z.number(),
  revisionId: z.string().optional(),
  onshapeCompanyId: z.string().optional()
});

type OnshapeRevisionSyncPayload = z.infer<
  typeof OnshapeRevisionSyncPayloadSchema
>;

function assetKindForElementType(elementType: number): OnshapeSyncAssetKind {
  return elementType === 2 ? "drawing" : "model";
}

// Which skip reasons an ITEM row may carry. 'ambiguous-item' is deliberately
// absent: a release that matched several candidate parts is not attributable to
// one of them, so an automatic sync records it at run level only. A
// user-initiated re-pull on a known item is the one path that records it.
function itemSkipReasonFor(
  skippedReason: OnshapeRevisionSyncResult["skippedReason"]
): "revision-not-found" | "asset-too-large" | null {
  if (skippedReason === "asset-too-large") return "asset-too-large";
  if (skippedReason === "revision-not-found") return "revision-not-found";
  return null;
}

// Best-effort sync state for this release. Only written once the sync resolved
// WHICH Carbon item the release belongs to — a release matching no item (or
// several) has no item row to own the outcome.
async function recordRevisionSyncState(
  carbon: CarbonClient,
  payload: OnshapeRevisionSyncPayload,
  result: OnshapeRevisionSyncResult
): Promise<{ recorded: boolean }> {
  if (!result.itemId) {
    return { recorded: false };
  }
  const assetKind = assetKindForElementType(payload.elementType);
  const written = await upsertItemSyncState(carbon, {
    companyId: payload.companyId,
    // The Onshape integration installer — the acting user for every webhook sync.
    userId: payload.userId,
    itemId: result.itemId,
    assetKind,
    status: result.synced ? "synced" : "skipped",
    source: "webhook",
    skipReason: result.synced ? null : itemSkipReasonFor(result.skippedReason),
    partNumber: payload.partNumber,
    revision: result.revision,
    revisionId: payload.revisionId,
    documentId: payload.documentId,
    versionId: payload.versionId,
    elementId: payload.elementId,
    releaseState: result.releaseState,
    modelUploadId: assetKind === "model" ? (result.modelUploadId ?? null) : null
  });
  return { recorded: written.applied };
}

export const onshapeRevisionSyncFunction = inngest.createFunction(
  {
    id: "onshape-revision-sync",
    retries: 3,
    idempotency: "event.data.messageId",
    // One in-flight sync per released element; different elements run in parallel.
    concurrency: { key: "event.data.elementId", limit: 1 },
    // A run that exhausted its retries records the failure on the item row for
    // the released element AND revision it was syncing — every revision of a
    // part is released from the same element but lives on its own Carbon item,
    // so the failure belongs to this revision's row alone. The row exists once
    // any earlier sync of the same release wrote one; a first-ever sync that
    // fails before it resolves an item has nothing to attribute the failure to.
    onFailure: async ({ event }) => {
      const { companyId, userId, elementId, elementType, revisionId } = event
        .data.event.data as OnshapeRevisionSyncPayload;
      await markItemSyncStateFailedByElement(getCarbonServiceRole(), {
        companyId,
        userId,
        elementId,
        revisionId,
        assetKind: assetKindForElementType(elementType),
        error: event.data.error.message
      });
    }
  },
  { event: "carbon/onshape-revision-sync" },
  async ({ event, step }) => {
    const payload = OnshapeRevisionSyncPayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    // Gate check (shared with the backfill): only run when the company turned
    // asset sync on and the integration is active. Runs every execution so
    // flipping the toggle off also kills an in-flight retry.
    if (!(await isOnshapeAssetSyncEnabled(carbon, payload.companyId))) {
      console.log("onshape-revision-sync: skipped (disabled or inactive)", {
        companyId: payload.companyId,
        partNumber: payload.partNumber
      });
      return { skipped: true as const };
    }

    // Wrap in the 429 backoff (same as the backfill's per-item syncs) so a rate
    // limit during export/poll/download backs off instead of bubbling out.
    const result = await step.run("sync-revision", () =>
      withRateLimitRetry(
        () => runOnshapeRevisionSync(carbon, payload),
        `revision ${payload.partNumber}`
      )
    );

    // Own memoized step: the function body replays on every step invocation, so
    // a write placed at body level would re-run on each replay.
    await step.run("record-item-state", () =>
      recordRevisionSyncState(carbon, payload, result)
    );

    if (result.synced && result.modelUploadId) {
      // The sync stores the RAW Onshape export; the assembler turns it into
      // the meshopt-compressed viewer GLB (same event the manual upload route
      // fires).
      await step.sendEvent("model-optimize", {
        name: "carbon/model-optimize" as const,
        data: {
          modelUploadId: result.modelUploadId,
          companyId: payload.companyId,
          userId: payload.userId
        }
      });
    }

    if (result.synced && result.modelUploadId && !result.thumbnailAttached) {
      // Fallback only: the sync stores Onshape's server-rendered thumbnail
      // itself; the screenshot pipeline runs just when that fetch failed.
      await step.sendEvent("model-thumbnail", {
        name: "carbon/model-thumbnail" as const,
        data: { companyId: payload.companyId, modelId: result.modelUploadId }
      });
    }

    return result;
  }
);
