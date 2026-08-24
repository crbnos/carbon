// Attaching released Onshape drawings to the Carbon items their models produced.
//
// DIRECTION ASYMMETRY is the thing to understand here. Onshape's references
// endpoint runs drawing → model, and there is no inverse: nothing can ask
// "which drawings point at this element". So a MODEL-FIRST caller — a BOM
// import, a create-from-Onshape, a model release — has to list the document's
// elements, call references on every drawing it finds, and keep the ones that
// point back at an item it cares about.
//
// That costs 1 + N calls per document-version, which is why this takes a LIST of
// targets and is called once per (documentId, versionId) rather than once per
// element. A BOM import over a tree living in one document would otherwise
// repeat the whole enumeration for every element group.

import type { Database } from "@carbon/database";
import type { OnshapeClient } from "@carbon/ee/onshape";
import {
  listDocumentElements,
  OnshapeAssetTooLargeError,
  resolveDrawingModelItem
} from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncOnshapeDrawingAssetsToItem } from "./onshape-sync-element";
import { isTransientExportError } from "./onshape-v2-assets";

type Carbon = SupabaseClient<Database>;

export interface OnshapeDrawingTarget {
  /** The MODEL element whose drawing we want. */
  elementId: string;
  itemId: string;
  /** Stable across runs — the document filename is the attach idempotency key. */
  assetBaseName: string;
  /** The released revision, used to pick the right family member. */
  revision?: string;
}

export interface PullOnshapeDrawingsResult {
  attached: Array<{ itemId: string; drawingElementId: string }>;
  skipped: Array<{ itemId?: string; reason: string }>;
}

/**
 * Find every drawing in one document version and attach each one's PDF to the
 * Carbon item of the model it documents, for the models the caller names.
 *
 * Refusals are returned rather than thrown — one undocumentable drawing must
 * not cost the others theirs — EXCEPT transient failures, which escape so the
 * caller's `withRateLimitRetry` can turn a 429 into a `RetryAfterError`.
 */
export async function pullOnshapeDrawingsForDocument(
  carbon: Carbon,
  client: OnshapeClient,
  args: {
    companyId: string;
    userId: string;
    /** WHICH Onshape record this pass is running for. */
    documentId: string;
    versionId: string;
    targets: OnshapeDrawingTarget[];
  }
): Promise<PullOnshapeDrawingsResult> {
  const result: PullOnshapeDrawingsResult = { attached: [], skipped: [] };
  if (args.targets.length === 0) return result;

  // ONE listing for the whole document version: it supplies both the drawings
  // to walk and the model-element lookup every resolution needs.
  const { isModelElement, drawings } = await listDocumentElements(client, {
    documentId: args.documentId,
    wvm: "v",
    wvmId: args.versionId
  });

  if (drawings.length === 0) return result;

  for (const drawing of drawings) {
    try {
      // The revision to narrow by is the drawing's own released revision, which
      // we do not know here — a model-first caller only knows the model's. They
      // bump together in a release (a drawing release pulls its whole model
      // tree into the candidate), so the model's revision is the right key.
      const anyTargetRevision =
        args.targets.find((target) => target.revision)?.revision ?? "";

      const resolved = await resolveDrawingModelItem(client, carbon, {
        companyId: args.companyId,
        documentId: args.documentId,
        wvm: "v",
        wvmId: args.versionId,
        drawingElementId: drawing.elementId,
        releasedRevision: anyTargetRevision,
        isModelElement
      });

      if (!resolved.ok) {
        // A drawing pointing at a model this caller did not ask about is not a
        // refusal — it is simply someone else's drawing. Only report a genuine
        // failure to resolve.
        if (resolved.reason !== "drawing-model-unmapped") {
          result.skipped.push({ reason: resolved.message });
        }
        continue;
      }

      // Keep only drawings whose resolved item is one the caller named. The
      // resolution above already tied the drawing to an item; this is the
      // model-first filter.
      const target = args.targets.find(
        (candidate) => candidate.itemId === resolved.itemId
      );
      if (!target) continue;

      await syncOnshapeDrawingAssetsToItem(carbon, {
        client,
        companyId: args.companyId,
        userId: args.userId,
        itemId: resolved.itemId,
        sourceDocument: "Part",
        documentId: args.documentId,
        versionId: args.versionId,
        drawingElementId: drawing.elementId,
        assetBaseName: target.assetBaseName
      });

      result.attached.push({
        itemId: resolved.itemId,
        drawingElementId: drawing.elementId
      });
    } catch (error) {
      // Same classification the model pull uses: a rate limit or 5xx must
      // escape so the caller's wrapper can reschedule the run. Swallowing it
      // here would turn one 429 into a permanent "no drawing" for every
      // remaining element.
      if (isTransientExportError(error)) throw error;

      result.skipped.push({
        reason:
          error instanceof OnshapeAssetTooLargeError
            ? `The Onshape drawing ${drawing.name ?? drawing.elementId} exports larger than Carbon accepts.`
            : error instanceof Error
              ? error.message
              : `Could not export the Onshape drawing ${drawing.name ?? drawing.elementId}.`
      });
    }
  }

  // Deliberately silent about targets with no drawing at all: most parts do not
  // have one, and reporting that as an outcome would bury the real refusals.
  return result;
}
