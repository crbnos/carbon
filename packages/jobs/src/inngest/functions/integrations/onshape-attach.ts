import { openAsBlob } from "node:fs";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { resolveModelSourceBucket } from "../tasks/assembler-client";

// Carbon-side attachment of Onshape released assets to an item. Lives in
// @carbon/jobs (not @carbon/ee): it needs the service-role client + document
// writes, and the release-sync/backfill Inngest functions (its callers) live here.
//
// The caller (release-sync job) is responsible for:
//   - resolving `itemId` by matching the Onshape part number + revision against
//     item.readableIdWithRevision (LINK-ONLY: skip if no match, do NOT create);
//   - downloading the GLTF/PDF from Onshape (OnshapeClient export methods);
//   - sending the "carbon/model-optimize" event for the returned modelUploadId
//     (the assembler turns the raw export into the viewer GLB) and the
//     "carbon/model-thumbnail" fallback (both via step.sendEvent).

type CarbonClient = SupabaseClient<Database>;
type DocumentSourceType = Database["public"]["Enums"]["documentSourceType"];

export interface OnshapeAssetFile {
  fileName: string;
  bytes: Uint8Array;
}

// Raw model export on disk. Streamed into storage via openAsBlob — a
// whole-vehicle GLTF export reaches 1.7GB and must never be buffered in memory.
export interface OnshapeModelFile {
  fileName: string;
  localPath: string;
  size: number;
}

export interface AttachOnshapeAssetsInput {
  companyId: string;
  createdBy: string; // userId for audit (the Onshape integration installer)
  itemId: string; // resolved Carbon item (caller guarantees it exists)
  sourceDocument: DocumentSourceType; // e.g. "Part"
  model?: OnshapeModelFile; // raw GLTF -> item's modelUpload (optimized by the assembler)
  documents?: OnshapeAssetFile[]; // drawing PDFs -> item documents
}

export interface AttachOnshapeAssetsResult {
  modelUploadId: string | null;
  documentIds: string[];
  preservedPriorModelAsDocument: boolean;
}

const BUCKET = "private";
// Raw model sources live in temp-staging (same as manual CadModel uploads); the
// model-optimize job reads from there and later zstd-compacts the raw in place.
const STAGING_BUCKET = "temp-staging";

function modelContentType(extension: string): string {
  return extension === "glb" ? "model/gltf-binary" : "model/gltf+json";
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
  const uploaded = await carbon.storage
    .from(BUCKET)
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
  // filename); the caller then fires "carbon/model-optimize" so the assembler
  // produces the viewer GLB.
  if (input.model) {
    const extension = fileExtension(input.model.fileName) || "gltf";

    // Resolve what the item currently points at first. This drives idempotency:
    // re-syncing the SAME model (identical filename — a step retry, webhook
    // redelivery, or backfill re-run) must replace it in place, not pile up new
    // modelUpload rows + duplicate "preserved" documents.
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
    const priorModel = priorModelId
      ? (
          await carbon
            .from("modelUpload")
            .select("id, name, modelPath, size")
            .eq("id", priorModelId)
            .eq("companyId", companyId)
            .maybeSingle()
        ).data
      : null;

    // openAsBlob streams the file from disk on demand — the export is never
    // read into memory.
    const rawBlob = await openAsBlob(input.model.localPath, {
      type: modelContentType(extension)
    });

    if (priorModel?.modelPath && priorModel.name === input.model.fileName) {
      // Same model re-synced → refresh the raw + row in place. No new
      // modelUpload, no repoint, no preserve. The row's modelPath may point at
      // a zstd-compacted raw (model-optimize compacts after optimising), so
      // upload to the canonical staging path and repoint rather than
      // overwriting the stored object.
      const modelPath = `${companyId}/models/${priorModel.id}.${extension}`;
      const reupload = await carbon.storage
        .from(STAGING_BUCKET)
        .upload(modelPath, rawBlob, {
          upsert: true,
          contentType: modelContentType(extension)
        });
      if (reupload.error) {
        throw new Error(
          `attachOnshapeAssetsToItem: model re-upload failed: ${reupload.error.message}`
        );
      }
      if (priorModel.modelPath !== modelPath) {
        // Best-effort: drop the superseded object (e.g. the old .zst compact).
        await carbon.storage
          .from(STAGING_BUCKET)
          .remove([priorModel.modelPath])
          .catch(() => {});
      }
      const refresh = await carbon
        .from("modelUpload")
        .update({
          modelPath,
          size: input.model.size,
          originalSize: input.model.size,
          updatedBy: createdBy,
          updatedAt: new Date().toISOString()
        })
        .eq("id", priorModel.id)
        .eq("companyId", companyId);
      if (refresh.error) {
        throw new Error(
          `attachOnshapeAssetsToItem: modelUpload refresh failed: ${refresh.error.message}`
        );
      }
      modelUploadId = priorModel.id;
    } else {
      // New model (or a genuinely different one). Upload + insert a fresh row.
      const modelId = nanoid();
      const modelPath = `${companyId}/models/${modelId}.${extension}`;
      const modelUpload = await carbon.storage
        .from(STAGING_BUCKET)
        .upload(modelPath, rawBlob, {
          upsert: true,
          contentType: modelContentType(extension)
        });
      if (modelUpload.error) {
        throw new Error(
          `attachOnshapeAssetsToItem: model upload failed: ${modelUpload.error.message}`
        );
      }
      const modelRecord = await carbon
        .from("modelUpload")
        .insert({
          id: modelId,
          modelPath,
          name: input.model.fileName,
          size: input.model.size,
          // Frozen as-uploaded bytes: `size` is later overwritten with the
          // compacted (.zst) stored size (model-optimize), but the viewer's
          // reduction badge compares the original.
          originalSize: input.model.size,
          companyId,
          createdBy
        })
        .select("id")
        .single();
      if (modelRecord.error) {
        throw new Error(
          `attachOnshapeAssetsToItem: modelUpload insert failed: ${modelRecord.error.message}`
        );
      }

      // Preserve a genuinely different prior model (e.g. a manual upload) as a
      // document before repointing, so nothing is destroyed. The item's Documents
      // tab lists objects under {companyId}/parts/{itemId} (items.service.ts), so
      // copy the file there. Preserve failures are logged, never fatal.
      if (priorModel?.modelPath) {
        const preservedName = stripSpecialCharacters(
          priorModel.name ?? `prior-model-${priorModel.id}`
        );
        const preservedPath = `${companyId}/parts/${itemId}/${preservedName}`;
        // Raw sources live in temp-staging since the assembler pipeline;
        // pre-pipeline rows live in private. Copy into private either way so
        // the preserved file sits with the item's documents.
        const priorBucket = await resolveModelSourceBucket(
          carbon,
          priorModel.modelPath
        );
        const copied = await carbon.storage
          .from(priorBucket)
          .copy(priorModel.modelPath, preservedPath, {
            destinationBucket: BUCKET
          });
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
        .update({ modelUploadId: modelId })
        .eq("id", itemId)
        .eq("companyId", companyId);
      if (itemLink.error) {
        throw new Error(
          `attachOnshapeAssetsToItem: item model link failed: ${itemLink.error.message}`
        );
      }
      modelUploadId = modelId;
    }
  }

  // --- Documents (drawing PDFs + overflow STEP) -> company-visible rows ------
  for (const document of input.documents ?? []) {
    const safeName = stripSpecialCharacters(document.fileName);
    const documentPath = `${companyId}/parts/${itemId}/${safeName}`;

    const documentUpload = await carbon.storage
      .from(BUCKET)
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
