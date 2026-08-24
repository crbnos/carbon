// Onshape v2 asset pull.
//
// Pulls the CAD model for items the v2 pipeline has already RESOLVED — this
// module never answers "which Carbon item is this", because getting that wrong
// is the recurring v2 bug: the element mapping is revision-agnostic
// (allowDuplicateExternalId = true), so attaching by element alone would put
// revision A's geometry on the item at revision C. Callers resolve through
// resolveBomRow and hand this module the itemId they landed on.
//
// Two hard constraints from the existing machinery shape everything here:
//
//   * A local export file cannot cross an Inngest step boundary — each step.run
//     is a separate HTTP invocation — so export and attach happen in ONE call,
//     which is also why this owns its scratch directory.
//   * `attachOnshapeAssetsToItem` uses the model FILENAME as its idempotency
//     key. A base name that varies between runs (a timestamp, Onshape's
//     translation name) mints a new modelUpload every time and files the
//     previous model away as a document, so the caller must pass something
//     stable — readableIdWithRevision, as the legacy callers do.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@carbon/database";
import type { OnshapeClient } from "@carbon/ee/onshape";
import { OnshapeApiError, OnshapeAssetTooLargeError } from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attachModelThumbnail,
  attachOnshapeAssetsToItem
} from "./onshape-attach";
import { exportOnshapeModelToDisk } from "./onshape-sync-element";

type Carbon = SupabaseClient<Database>;

export type OnshapeAssetTarget = {
  itemId: string;
  /** A Part Studio body, or null for an assembly element. */
  partId: string | null;
  /** Stable across runs — the model filename is the idempotency key. */
  assetBaseName: string;
  /**
   * The Onshape configuration string this BOM row was instanced with.
   *
   * Omitting it exports the element's DEFAULT configuration, which for a
   * configured part is a different shape from the one the BOM line names —
   * the same class of silent geometry lie as exporting a whole Part Studio
   * for one body.
   */
  configuration?: string | null;
};

export type OnshapeAssetPullResult = {
  attached: Array<{ itemId: string; modelUploadId: string }>;
  skipped: Array<{ itemId: string; reason: string }>;
};

/**
 * Worth another attempt, as opposed to permanently unexportable.
 *
 * A rate limit and a 5xx are the same failure the whole job is built to
 * survive. A status-less OnshapeApiError is the client's 60s timeout, which is
 * also transient. A 4xx that is not 429 is the caller asking for something
 * Onshape will refuse every time, so it stays a per-target skip.
 */
export function isTransientExportError(error: unknown): boolean {
  if (error instanceof OnshapeAssetTooLargeError) return false;
  if (error instanceof OnshapeApiError) {
    if (error.status === 429) return true;
    if (error.status === undefined || error.status === null) return true;
    return error.status >= 500;
  }
  return false;
}

/**
 * Pull models for every target that lives in ONE Onshape element.
 *
 * Grouping by element is what keeps the Onshape call count sane: the client,
 * the scratch directory and the element thumbnail are each obtained once and
 * reused for every body in that element.
 */
export async function pullOnshapeAssetsForElement(
  carbon: Carbon,
  client: OnshapeClient,
  args: {
    companyId: string;
    userId: string;
    documentId: string;
    versionId: string;
    elementId: string;
    targets: OnshapeAssetTarget[];
  }
): Promise<OnshapeAssetPullResult> {
  const result: OnshapeAssetPullResult = { attached: [], skipped: [] };
  if (args.targets.length === 0) return result;

  const scratchDir = await mkdtemp(join(tmpdir(), "onshape-assets-"));

  // One render for the whole element, reused by every body in it. Best effort:
  // a missing thumbnail is cosmetic, and the model-thumbnail pipeline renders
  // one from the GLB anyway.
  let thumbnail: Uint8Array | null = null;
  try {
    const png = await client.getElementThumbnail(
      args.documentId,
      args.versionId,
      args.elementId
    );
    thumbnail = png instanceof Uint8Array ? png : null;
  } catch {
    thumbnail = null;
  }

  try {
    for (const target of args.targets) {
      try {
        const model = await exportOnshapeModelToDisk(
          client,
          {
            documentId: args.documentId,
            versionId: args.versionId,
            elementId: args.elementId,
            // A body belongs to a Part Studio; no body means the element IS
            // the thing being exported, i.e. an assembly.
            kind: target.partId ? "partstudio" : "assembly",
            partIds: target.partId ?? undefined,
            configuration: target.configuration ?? undefined,
            assetBaseName: target.assetBaseName
          },
          scratchDir
        );

        const attached = await attachOnshapeAssetsToItem(carbon, {
          companyId: args.companyId,
          createdBy: args.userId,
          itemId: target.itemId,
          sourceDocument: "Part",
          model,
          // v2 fans out over every target in a release, so two attaches can
          // reach the same item concurrently. Refuse rather than overwrite: the
          // step retries (retries: 3, per-element concurrency 1) and re-reads,
          // where an unconditional write would orphan the loser's uploaded
          // model row. The legacy paths keep the default.
          onConcurrentChange: "refuse"
        });

        if (attached.modelUploadId) {
          result.attached.push({
            itemId: target.itemId,
            modelUploadId: attached.modelUploadId
          });

          // Only when the ELEMENT is what was exported. getElementThumbnail
          // takes no partId, so one Part Studio render covers every body in it
          // — stamping it on a per-body item shows the whole studio as the
          // picture of one part, which is the same lie `partIds` exists to
          // stop, reintroduced as the image. A body gets its thumbnail from
          // its own GLB via the model-thumbnail chain below.
          if (thumbnail && target.partId === null) {
            try {
              await attachModelThumbnail(carbon, {
                companyId: args.companyId,
                modelUploadId: attached.modelUploadId,
                pngBytes: thumbnail
              });
            } catch {
              // Cosmetic only — never fail an attach over a thumbnail.
            }
          }
        }
      } catch (error) {
        // A TRANSIENT failure must escape. The callers wrap this whole function
        // in withRateLimitRetry precisely so a 429 becomes an Inngest
        // RetryAfterError and the run is rescheduled; swallowing it here as a
        // per-target skip makes that wrapper unreachable and turns a rate limit
        // — which the jobs carry ten retries for — into a permanent "no model"
        // on every remaining row of the assembly.
        if (isTransientExportError(error)) throw error;

        // A too-large export is PERMANENT: retrying cannot shrink it, so it is
        // a skip rather than a failure, matching how the legacy callers treat
        // it. A permanent per-target failure is per-target too — one
        // unexportable body must not cost the other six their models.
        result.skipped.push({
          itemId: target.itemId,
          reason:
            error instanceof OnshapeAssetTooLargeError
              ? "The Onshape export is larger than Carbon accepts."
              : error instanceof Error
                ? error.message
                : "Could not export this model from Onshape."
        });
      }
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }

  return result;
}

/**
 * Group resolved targets by the element they live in.
 *
 * Seven parts sharing one Part Studio is the common case, not the exception —
 * grouping turns seven client constructions and seven thumbnail fetches into
 * one of each.
 */
export function groupAssetTargetsByElement<
  T extends {
    documentId: string;
    versionId: string;
    elementId: string;
    partId: string | null;
    itemId: string;
    assetBaseName: string;
    configuration?: string | null;
  }
>(rows: T[]) {
  const groups = new Map<
    string,
    {
      documentId: string;
      versionId: string;
      elementId: string;
      targets: OnshapeAssetTarget[];
    }
  >();

  for (const row of rows) {
    // The configuration is part of the identity of what gets exported, so two
    // configurations of one element are two groups, not one.
    const key = `${row.documentId}:${row.versionId}:${row.elementId}:${row.configuration ?? ""}`;
    const group = groups.get(key) ?? {
      documentId: row.documentId,
      versionId: row.versionId,
      elementId: row.elementId,
      targets: []
    };
    // One body maps to one item; a duplicate target would export twice and
    // attach the same file twice.
    if (!group.targets.some((t) => t.itemId === row.itemId)) {
      group.targets.push({
        itemId: row.itemId,
        partId: row.partId,
        assetBaseName: row.assetBaseName,
        configuration: row.configuration ?? null
      });
    }
    groups.set(key, group);
  }

  return Array.from(groups.values());
}
