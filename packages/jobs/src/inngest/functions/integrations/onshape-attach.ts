// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import {
  getCompanyPrivateBucket,
  storage,
  TEMP_STAGING_BUCKET
} from "@carbon/files";
import { isUniqueViolation } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveModelSourceBucket } from "../tasks/assembler-client";

// Carbon-side attachment of Onshape released assets to an item. Lives in
// @carbon/jobs (not @carbon/ee): it needs the service-role client + document
// writes, and the release-sync/backfill Inngest functions (its callers) live here.
//
// The caller (the Onshape sync pipeline) is responsible for:
//   - resolving `itemId` by matching the Onshape part number + revision against
//     item.readableIdWithRevision (LINK-ONLY: skip if no match, do NOT create);
//   - staging the STEP export (the assembler's `fetch` puts it in temp-staging)
//     and downloading drawing PDFs.
// A new modelUpload row starts the model pipeline itself (the
// `queue_model_pipeline` statement handler), so no caller sends model-optimize.

type CarbonClient = SupabaseClient<Database>;
type DocumentSourceType = Database["public"]["Enums"]["documentSourceType"];

export interface OnshapeAssetFile {
  fileName: string;
  bytes: Uint8Array;
}

// A raw model export already in temp-staging, put there by whoever fetched it
// (the assembler's `fetch`, or the no-assembler fallback). Never read here: a
// whole-vehicle STEP export reaches several GB.
export interface OnshapeModelFile {
  fileName: string;
  stagedPath: string; // key in TEMP_STAGING_BUCKET
  size: number;
  contentHash: string; // of the bytes, from whoever staged them
  // Stable ID derived by the exporter from the exact released source + its
  // selection generation. An ID identifies immutable bytes, never a filename.
  sourceId?: string;
}

export interface AttachOnshapeAssetsInput {
  companyId: string;
  createdBy: string; // userId for audit (the Onshape integration installer)
  itemId: string; // resolved Carbon item (caller guarantees it exists)
  sourceDocument: DocumentSourceType; // e.g. "Part"
  model?: OnshapeModelFile; // raw STEP -> item's modelUpload (optimized by the assembler)
  // A model the sync found already exported (same released source): link it,
  // nothing to move. Exclusive with `model`.
  existingModelId?: string;
  documents?: OnshapeAssetFile[]; // drawing PDFs -> item documents
}

export interface AttachOnshapeAssetsResult {
  modelUploadId: string | null;
  documentIds: string[];
  preservedPriorModelAsDocument: boolean;
}

function fileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

// Mirrors ~/utils/string stripSpecialCharacters (app-only, not importable here):
// keep only characters valid for storage (S3) keys.
function stripSpecialCharacters(inputString: string): string {
  return inputString.replace(/[^a-zA-Z0-9/!_\-.*'() &$@=;:+,?]/g, "");
}

// document.type is a required `documentType` enum (NOT generated). Our synced
// assets are drawing PDFs or CAD models; map explicitly since the filename->enum
// helper (shared.service.ts) is app-only and not importable here.
function documentTypeForFile(
  fileName: string
): Database["public"]["Enums"]["documentType"] {
  return fileExtension(fileName) === "pdf" ? "PDF" : "Other";
}

// A corrected part selection must not reuse the legacy modelUpload ID: active
// optimize/compact/thumbnail jobs still own that ID and may finish later. New
// sources get independent artifacts; exact-source retries reuse the existing
// row including any compacted source path and completed viewer artifacts.
async function ensureImmutableModel(
  carbon: CarbonClient,
  input: { companyId: string; createdBy: string; model: OnshapeModelFile },
  modelId: string
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(modelId)) {
    throw new Error("attachOnshapeAssetsToItem: invalid model source ID");
  }
  const lookup = async () => {
    const result = await carbon
      .from("modelUpload")
      .select("id, name, modelPath")
      .eq("id", modelId)
      .eq("companyId", input.companyId)
      .maybeSingle();
    if (result.error) {
      throw new Error(
        `attachOnshapeAssetsToItem: source model lookup failed: ${result.error.message}`
      );
    }
    if (
      result.data &&
      (!result.data.modelPath || result.data.name !== input.model.fileName)
    ) {
      throw new Error(
        "attachOnshapeAssetsToItem: source model identity mismatch"
      );
    }
    return result.data;
  };
  const staging = carbon.storage.from(TEMP_STAGING_BUCKET);
  if (await lookup()) {
    // Already attached: the staged copy is a duplicate of its bytes.
    await staging.remove([input.model.stagedPath]);
    return modelId;
  }

  // The stem must be the model id (the artifacts route derives the id from
  // the file name), so the staged object moves to its final key.
  const extension = fileExtension(input.model.fileName) || "step";
  const modelPath = `${input.companyId}/models/${modelId}.${extension}`;
  const moved = await staging.move(input.model.stagedPath, modelPath);
  // A concurrent redelivery, or a retry after the move but before the insert,
  // already moved these immutable bytes: the final object is what counts.
  // Never overwrite it. Both callers then converge on the primary key below.
  if (moved.error) {
    const landed = await staging.info(modelPath);
    if (landed.error) {
      throw new Error(
        `attachOnshapeAssetsToItem: model move failed: ${moved.error.message}`
      );
    }
    await staging.remove([input.model.stagedPath]);
  }
  const inserted = await carbon
    .from("modelUpload")
    .insert({
      id: modelId,
      modelPath,
      name: input.model.fileName,
      size: input.model.size,
      originalSize: input.model.size,
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id")
    .single();
  if (inserted.error) {
    // Do not turn a failed write into success unless another caller actually
    // committed THIS model in THIS company. Other insert errors remain errors.
    if (!isUniqueViolation(inserted.error) || !(await lookup())) {
      throw new Error(
        `attachOnshapeAssetsToItem: modelUpload insert failed: ${inserted.error.message}`
      );
    }
  }
  return modelId;
}

// An export with no immutable source (an assembly, or a workspace part with
// no microversion) is named by its bytes. Unchanged bytes reuse their model.
// Changed bytes get a new model: every derived file (the compacted raw, the
// preview, the assembly graph) is keyed by the model id, and a durable copy is
// never overwritten, so refreshing a model in place kept the old geometry.
// The bytes' hash comes from whoever staged them, so nothing reads them again.
export function contentSourceId(
  companyId: string,
  itemId: string,
  model: Pick<OnshapeModelFile, "fileName" | "contentHash">
): string {
  const hash = createHash("sha256").update(
    JSON.stringify([
      "content-v2",
      companyId,
      itemId,
      model.fileName,
      model.contentHash
    ])
  );
  return `onshape-${hash.digest("hex")}`;
}

// "Replace rather than append": one document row per storage path, so re-running
// a sync (or an Inngest step retry) updates the existing row instead of
// accumulating duplicates. Returns the document id.
async function upsertSyncedDocument(
  carbon: CarbonClient,
  row: {
    path: string;
    name: string;
    size: number;
    sourceDocument: DocumentSourceType;
    sourceDocumentId: string;
    companyId: string;
    userId: string;
    groups: string[];
  }
): Promise<string> {
  const existing = await carbon
    .from("document")
    .select("id")
    .eq("companyId", row.companyId)
    .eq("path", row.path)
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new Error(
      `upsertSyncedDocument: lookup failed (${row.path}): ${existing.error.message}`
    );
  }

  if (existing.data?.id) {
    const updated = await carbon
      .from("document")
      .update({
        name: row.name,
        size: row.size,
        type: documentTypeForFile(row.name),
        updatedBy: row.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", existing.data.id)
      .eq("companyId", row.companyId);
    if (updated.error) {
      throw new Error(
        `upsertSyncedDocument: update failed (${row.path}): ${updated.error.message}`
      );
    }
    return existing.data.id;
  }

  const inserted = await carbon
    .from("document")
    .insert({
      path: row.path,
      name: row.name,
      size: row.size,
      type: documentTypeForFile(row.name),
      sourceDocument: row.sourceDocument,
      sourceDocumentId: row.sourceDocumentId,
      companyId: row.companyId,
      createdBy: row.userId,
      readGroups: row.groups,
      writeGroups: row.groups
    })
    .select("id")
    .single();
  if (inserted.error) {
    throw new Error(
      `upsertSyncedDocument: insert failed (${row.path}): ${inserted.error.message}`
    );
  }
  return inserted.data.id;
}

// Store an Onshape-rendered thumbnail for a modelUpload, matching the
// model-thumbnail pipeline's path convention
// ({companyId}/thumbnails/{modelId}/{modelId}.png) so both producers are
// interchangeable to consumers of modelUpload.thumbnailPath.
export async function attachModelThumbnail(
  carbon: CarbonClient,
  input: { companyId: string; modelUploadId: string; pngBytes: Uint8Array }
): Promise<void> {
  const thumbnailPath = `${input.companyId}/thumbnails/${input.modelUploadId}/${input.modelUploadId}.png`;
  const uploaded = await storage(carbon)
    .company(input.companyId)
    .upload(thumbnailPath, input.pngBytes, {
      upsert: true,
      contentType: "image/png"
    });
  if (uploaded.error) {
    throw new Error(
      `attachModelThumbnail: upload failed (${thumbnailPath}): ${uploaded.error.message}`
    );
  }
  const updated = await carbon
    .from("modelUpload")
    .update({ thumbnailPath })
    .eq("id", input.modelUploadId)
    .eq("companyId", input.companyId);
  if (updated.error) {
    throw new Error(
      `attachModelThumbnail: modelUpload update failed: ${updated.error.message}`
    );
  }
}

export async function attachOnshapeAssetsToItem(
  carbon: CarbonClient,
  input: AttachOnshapeAssetsInput
): Promise<AttachOnshapeAssetsResult> {
  const { companyId, createdBy, itemId, sourceDocument } = input;

  // Company root group -> company-wide document visibility (every employee reaches
  // it via groups_for_user). Note: no Carbon doc is company-visible via [userId];
  // synced release assets are intentionally broader than manual uploads.
  const company = await carbon
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error || !company.data?.companyGroupId) {
    throw new Error(
      `attachOnshapeAssetsToItem: could not resolve companyGroupId for company ${companyId}`
    );
  }
  const companyGroups = [company.data.companyGroupId];

  const documentIds: string[] = [];
  let modelUploadId: string | null = null;
  let preservedPriorModelAsDocument = false;

  // --- Primary model -> modelUpload + item.modelUploadId --------------------
  // The raw export lands in temp-staging exactly like a manual CadModel upload
  // (path stem == modelUpload.id — the artifacts route derives the id from the
  // filename); inserting the row starts the optimise that produces the viewer
  // GLB.
  const model = input.model;
  if (model || input.existingModelId) {
    // Resolve the current model before linking a released source. Item identity
    // and its manufacturing records are unchanged; only its model pointer moves.
    const currentItem = await carbon
      .from("item")
      .select("modelUploadId")
      .eq("id", itemId)
      .eq("companyId", companyId)
      .single();
    if (currentItem.error) {
      // Abort rather than treat "lookup failed" as "no prior model" — that
      // would repoint the item without preserving what it currently has.
      throw new Error(
        `attachOnshapeAssetsToItem: item lookup failed for ${itemId}: ${currentItem.error.message}`
      );
    }
    const priorModelId = currentItem.data?.modelUploadId ?? null;
    const priorResult = priorModelId
      ? await carbon
          .from("modelUpload")
          .select("id, name, modelPath, size")
          .eq("id", priorModelId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null;
    if (priorResult?.error) {
      throw new Error(
        `attachOnshapeAssetsToItem: prior model lookup failed: ${priorResult.error.message}`
      );
    }
    const priorModel = priorResult?.data ?? null;

    modelUploadId =
      input.existingModelId ??
      (await ensureImmutableModel(
        carbon,
        { companyId, createdBy, model: model! },
        model!.sourceId ?? contentSourceId(companyId, itemId, model!)
      ));

    if (modelUploadId !== priorModelId) {
      // Preserve a genuinely different prior model (e.g. a manual upload) as a
      // document before repointing, so nothing is destroyed. The item's Documents
      // tab lists objects under {companyId}/parts/{itemId} (items.service.ts), so
      // copy the file there. Preserve failures are logged, never fatal.
      // Filename equality is NOT provenance — a manual upload can share the
      // released export's filename, and keying preservation off it silently
      // dropped that manual model. Preserve unless the prior model is itself a
      // prior Onshape immutable generation (its id carries the "onshape-" source
      // prefix minted by ensureImmutableModel): those are superseded
      // auto-generated artifacts, kept as a record for existing references but
      // never re-attached as a misleading duplicate document.
      // One exception, for an export with no source id only: a prior model
      // with the same file name is that export's earlier sync. Those syncs
      // refreshed one row in place and gave it a plain id, so the prefix cannot
      // mark them. Main overwrote such a row; here it stays in storage, just
      // not re-listed as a document.
      const priorIsOnshapeGeneration =
        (priorModel?.id ?? "").startsWith("onshape-") ||
        (model !== undefined &&
          model.sourceId === undefined &&
          priorModel?.name === model.fileName);
      if (priorModel?.modelPath && !priorIsOnshapeGeneration) {
        const preservedName = stripSpecialCharacters(
          priorModel.name ?? `prior-model-${priorModel.id}`
        );
        const preservedPath = `${companyId}/parts/${itemId}/${preservedName}`;
        // The raw source is in the company bucket once durable, else in
        // temp-staging. Copy it into the company bucket so the preserved file
        // sits with the item's documents.
        const priorBucket = await resolveModelSourceBucket(
          companyId,
          priorModel.modelPath
        );
        const copied = priorBucket
          ? await carbon.storage
              .from(priorBucket)
              .copy(priorModel.modelPath, preservedPath, {
                destinationBucket: getCompanyPrivateBucket(companyId)
              })
          : { error: { message: "the prior model file is not in storage" } };
        if (copied.error && !/already exists/i.test(copied.error.message)) {
          console.error(
            `attachOnshapeAssetsToItem: failed to copy prior model ${priorModel.id} for preservation`,
            copied.error
          );
        } else {
          try {
            const preservedId = await upsertSyncedDocument(carbon, {
              path: preservedPath,
              name: priorModel.name ?? preservedName,
              size: priorModel.size ?? 0,
              sourceDocument,
              sourceDocumentId: itemId,
              companyId,
              userId: createdBy,
              groups: companyGroups
            });
            documentIds.push(preservedId);
            preservedPriorModelAsDocument = true;
          } catch (preserveError) {
            console.error(
              `attachOnshapeAssetsToItem: failed to preserve prior model ${priorModel.id} as a document`,
              preserveError
            );
          }
        }
      }

      const itemLink = await carbon
        .from("item")
        .update({ modelUploadId })
        .eq("id", itemId)
        .eq("companyId", companyId);
      if (itemLink.error) {
        throw new Error(
          `attachOnshapeAssetsToItem: item model link failed: ${itemLink.error.message}`
        );
      }
    }
  }

  // --- Documents (drawing PDFs + overflow STEP) -> company-visible rows ------
  for (const document of input.documents ?? []) {
    const safeName = stripSpecialCharacters(document.fileName);
    const documentPath = `${companyId}/parts/${itemId}/${safeName}`;

    const documentUpload = await storage(carbon)
      .company(companyId)
      .upload(documentPath, document.bytes, { upsert: true });
    if (documentUpload.error) {
      throw new Error(
        `attachOnshapeAssetsToItem: document upload failed (${document.fileName}): ${documentUpload.error.message}`
      );
    }

    const documentId = await upsertSyncedDocument(carbon, {
      path: documentPath,
      name: document.fileName,
      size: document.bytes.byteLength,
      sourceDocument,
      sourceDocumentId: itemId,
      companyId,
      userId: createdBy,
      groups: companyGroups
    });
    documentIds.push(documentId);
  }

  return { modelUploadId, documentIds, preservedPriorModelAsDocument };
}
