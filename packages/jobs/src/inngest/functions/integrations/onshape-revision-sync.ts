// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { inngest } from "../../client";
import {
  isOnshapeAssetSyncEnabled,
  resolveOnshapeCompanyId
} from "./onshape-backfill";
import {
  escapeLikePattern,
  releaseKey,
  sharedNumberSuffix
} from "./onshape-matching";
import { withRateLimitRetry } from "./onshape-rate-limit";
import {
  ONSHAPE_CHECKPOINTING,
  runOnshapeDrawingSync,
  runOnshapeElementSync,
  type SyncOnshapeDrawingInput,
  type SyncOnshapeElementInput
} from "./onshape-sync-element";

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
    | "ambiguous-revision"
    | "asset-too-large"; // export exceeds Carbon's upload limits — permanent skip
  itemId?: string;
  modelUploadId?: string | null;
  thumbnailAttached?: boolean; // Onshape-rendered thumbnail stored — no fallback event needed
  releaseKey?: string;
}

// Onshape elementType is NUMERIC: 0 = Part Studio, 1 = Assembly, 2 = Drawing.
function modelKindForElementType(
  elementType: number
): "partstudio" | "assembly" | null {
  if (elementType === 1) return "assembly";
  if (elementType === 0) return "partstudio";
  return null;
}

/** A released model to export onto the item it matched. */
export interface OnshapeRevisionModel {
  element: SyncOnshapeElementInput;
  itemId: string;
  releaseKey: string;
}

/** A released drawing to export onto the model item sharing its number. */
export interface OnshapeRevisionDrawing {
  drawing: SyncOnshapeDrawingInput;
  itemId: string;
  releaseKey?: string;
}

/**
 * Resolve one released revision to what to do with it: a final result (a
 * skip, or a drawing already attached), or the model to export onto its item.
 * The export is not done here: it runs as the pipeline's own steps.
 */
export async function resolveOnshapeRevision(
  carbon: CarbonClient,
  input: OnshapeRevisionSyncInput
): Promise<
  OnshapeRevisionSyncResult | OnshapeRevisionModel | OnshapeRevisionDrawing
> {
  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(
      `resolveOnshapeRevision: getOnshapeClient failed: ${
        onshape.error ?? "no client"
      }`
    );
  }
  const client = onshape.client;

  const onshapeCompanyId =
    input.onshapeCompanyId ?? (await resolveOnshapeCompanyId(carbon, input));

  // The webhook is only a hint. Resolve one exact released source from Onshape;
  // never substitute another element in the same version or another document.
  const revisions = await client.getRevisions(
    onshapeCompanyId,
    input.partNumber,
    input.elementType
  );
  const revisionList = revisions.items ?? [];
  const matchingRevisions = revisionList.filter(
    (revision) =>
      !revision.isObsolete &&
      revision.documentId === input.documentId &&
      revision.versionId === input.versionId &&
      revision.elementId === input.elementId &&
      revision.elementType === input.elementType &&
      revision.partNumber === input.partNumber &&
      (!input.revisionId || revision.id === input.revisionId)
  );
  if (matchingRevisions.length > 1) {
    return { synced: false, skippedReason: "ambiguous-revision" };
  }
  const releasedRevision = matchingRevisions[0];

  if (!releasedRevision) {
    return { synced: false, skippedReason: "revision-not-found" };
  }
  const revision = releasedRevision.revision;

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
      .eq("type", "Part")
      .eq("revision", revision)
      .ilike("readableId", `%${escapeLikePattern(suffix)}`);
    if (candidates.error) {
      throw new Error(
        `resolveOnshapeRevision: drawing item match query failed: ${candidates.error.message}`
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
    return {
      itemId: target.id,
      releaseKey: target.readableIdWithRevision ?? undefined,
      drawing: {
        companyId: input.companyId,
        userId: input.userId,
        itemId: target.id,
        sourceDocument: "Part",
        documentId: input.documentId,
        versionId: input.versionId,
        drawingElementId: input.elementId,
        assetBaseName: target.readableIdWithRevision ?? undefined
      }
    };
  }

  // MODEL (elementType 0 = part studio, 1 = assembly): export STEP + attach.
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
    .eq("type", "Part")
    .eq("readableIdWithRevision", key)
    .maybeSingle();
  if (carbonItem.error) {
    throw new Error(
      `resolveOnshapeRevision: item match query failed: ${carbonItem.error.message}`
    );
  }
  if (!carbonItem.data) {
    return {
      synced: false,
      skippedReason: "no-matching-item",
      releaseKey: key
    };
  }

  return {
    itemId: carbonItem.data.id,
    releaseKey: key,
    element: {
      companyId: input.companyId,
      userId: input.userId,
      itemId: carbonItem.data.id,
      sourceDocument: "Part", // v1: released items are parts/assemblies
      documentId: input.documentId,
      versionId: input.versionId,
      modelElementId: input.elementId,
      modelElementKind,
      partId: releasedRevision.partId,
      configuration: releasedRevision.configuration,
      assetBaseName: key
    }
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

export const onshapeRevisionSyncFunction = inngest.createFunction(
  {
    id: "onshape-revision-sync",
    checkpointing: ONSHAPE_CHECKPOINTING,
    retries: 3,
    idempotency: "event.data.messageId",
    // One in-flight sync per released element; different elements run in parallel.
    concurrency: { key: "event.data.elementId", limit: 1 }
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

    // Wrap in the 429 backoff (same as the pipeline's own steps) so a rate
    // limit during the lookup backs off instead of bubbling out.
    const resolved = await step.run("resolve-revision", () =>
      withRateLimitRetry(
        () => resolveOnshapeRevision(carbon, payload),
        `revision ${payload.partNumber}`
      )
    );
    if ("drawing" in resolved) {
      const attached = await runOnshapeDrawingSync(
        step,
        carbon,
        resolved.drawing,
        "drawing"
      );
      // An oversized PDF is permanent: a retry can't shrink the export.
      return attached.tooLarge
        ? { synced: false, skippedReason: "asset-too-large" as const }
        : {
            synced: true,
            itemId: resolved.itemId,
            modelUploadId: attached.modelUploadId,
            releaseKey: resolved.releaseKey
          };
    }
    if (!("element" in resolved)) return resolved;

    // The sync stores the RAW Onshape export. A new model row starts the
    // optimise that builds the viewer GLB and the thumbnail.
    const attached = await runOnshapeElementSync(
      step,
      carbon,
      resolved.element,
      "element"
    );
    if (attached.tooLarge) {
      // Permanent: a retry can't shrink the export. Skip, don't fail. The
      // drawing PDF (a separate DRW element/event) still attaches normally.
      return {
        synced: false,
        skippedReason: "asset-too-large" as const,
        releaseKey: resolved.releaseKey
      };
    }
    return {
      synced: true,
      itemId: resolved.itemId,
      modelUploadId: attached.modelUploadId,
      thumbnailAttached: attached.thumbnailAttached,
      releaseKey: resolved.releaseKey
    };
  }
);
