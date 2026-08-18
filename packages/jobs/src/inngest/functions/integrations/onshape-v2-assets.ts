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
import { OnshapeAssetTooLargeError } from "@carbon/ee/onshape";
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
};

export type OnshapeAssetPullResult = {
  attached: Array<{ itemId: string; modelUploadId: string }>;
  skipped: Array<{ itemId: string; reason: string }>;
};

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

  const scratchDir = await mkdtemp(join(tmpdir(), "onshape-v2-assets-"));

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
            assetBaseName: target.assetBaseName
          },
          scratchDir
        );

        const attached = await attachOnshapeAssetsToItem(carbon, {
          companyId: args.companyId,
          createdBy: args.userId,
          itemId: target.itemId,
          sourceDocument: "Part",
          model
        });

        if (attached.modelUploadId) {
          result.attached.push({
            itemId: target.itemId,
            modelUploadId: attached.modelUploadId
          });

          if (thumbnail) {
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
        // A too-large export is PERMANENT: retrying cannot shrink it, so it is
        // a skip rather than a failure, matching how the legacy callers treat
        // it. Anything else is per-target too — one unexportable body must not
        // cost the other six their models.
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
    const key = `${row.documentId}:${row.versionId}:${row.elementId}`;
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
        assetBaseName: row.assetBaseName
      });
    }
    groups.set(key, group);
  }

  return Array.from(groups.values());
}
