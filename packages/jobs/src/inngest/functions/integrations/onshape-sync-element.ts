import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@carbon/database";
import type { OnshapeClient, OnshapeTranslation } from "@carbon/ee/onshape";
import { getOnshapeClient } from "@carbon/ee/onshape";
import { getFileSizeLimit } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AttachOnshapeAssetsResult,
  attachModelThumbnail,
  attachOnshapeAssetsToItem,
  type OnshapeModelFile
} from "./onshape-attach";

// Export→download→attach for ONE released Onshape element. Wires the OnshapeClient
// export methods (@carbon/ee) to the Carbon-side attach helper. Flow: create
// translation -> poll to DONE -> download from resultDocumentId/
// resultExternalDataIds -> attach. Poll-with-backoff (real completions take
// seconds); no translation.complete webhook needed.
//
// The caller (release-sync / backfill job) is responsible for turning a release
// event into these inputs: resolve itemId by part number (readableIdWithRevision,
// LINK-ONLY skip if none), and the documentId/versionId/elementId of the released
// geometry. Thumbnails: the model sync stores Onshape's server-rendered element
// thumbnail itself (thumbnailAttached: true); callers fire the
// "carbon/model-thumbnail" screenshot job only as a fallback when that fetch
// failed.

type CarbonClient = SupabaseClient<Database>;
type DocumentSourceType = Database["public"]["Enums"]["documentSourceType"];

export interface SyncOnshapeElementInput {
  companyId: string;
  userId: string; // Onshape integration installer (auth + audit)
  itemId: string; // resolved Carbon item (caller guarantees it exists)
  sourceDocument: DocumentSourceType; // e.g. "Part"
  documentId: string;
  versionId: string; // the released version
  modelElementId: string; // released Part Studio OR Assembly element to export
  modelElementKind: "partstudio" | "assembly"; // from the revision's elementType (0/1)
  drawingElementIds?: string[]; // optional PDF drawings (untested path — see client.ts)
  assetBaseName?: string; // filename base (e.g. item part number); falls back to Onshape name
}

const POLL_MAX_ATTEMPTS = 40;
const POLL_INITIAL_DELAY_MS = 2000;
const POLL_MAX_DELAY_MS = 15000;

// Size caps — the SAME limits Carbon enforces on manual uploads (CadModel.tsx /
// document upload), since synced assets land in the same buckets. The raw model
// cap is the temp-staging cap (2.5GB); exports past it are skipped permanently
// (drawing PDFs still attach — they are separate elements). Output size is the
// assembler's problem, not ours.
const RAW_MODEL_MAX_BYTES = getFileSizeLimit("CAD_MODEL_UPLOAD").bytes;
const DOCUMENT_MAX_BYTES = getFileSizeLimit("DOCUMENT_UPLOAD").bytes;

async function waitForTranslation(
  client: OnshapeClient,
  translationId: string
): Promise<OnshapeTranslation> {
  let delay = POLL_INITIAL_DELAY_MS;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const translation = await client.getTranslation(translationId);
    if (translation.requestState === "DONE") {
      return translation;
    }
    if (translation.requestState === "FAILED") {
      throw new Error(
        `Onshape translation ${translationId} FAILED: ${
          translation.failureReason ?? "unknown"
        }`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, POLL_MAX_DELAY_MS);
  }
  throw new Error(
    `Onshape translation ${translationId} did not finish after ${POLL_MAX_ATTEMPTS} polls`
  );
}

async function downloadTranslationBytes(
  client: OnshapeClient,
  translation: OnshapeTranslation,
  maxBytes: number
): Promise<Uint8Array> {
  const foreignId = translation.resultExternalDataIds?.[0];
  const documentId = translation.resultDocumentId;
  if (!foreignId || !documentId) {
    throw new Error(
      `Onshape translation ${translation.id} DONE but has no resultExternalDataIds/resultDocumentId`
    );
  }
  // Throws OnshapeAssetTooLargeError past the cap — callers treat that as a
  // permanent skip (retrying cannot shrink the asset).
  const buffer = await client.downloadExternalData(documentId, foreignId, {
    maxBytes
  });
  return new Uint8Array(buffer);
}

// The one and only model export path: export GLTF from Onshape and stream it
// to disk (a whole-vehicle export can be >1.5GB — it is never buffered in
// memory). The raw export is attached as-is; the assembler pipeline
// ("carbon/model-optimize", fired by the caller) turns it into the
// meshopt-compressed viewer GLB, so no local compression happens here. STEP
// export was deliberately dropped: real assemblies produce multi-GB STEP
// files, and Onshape stays the CAD system of record. Throws
// OnshapeAssetTooLargeError (from the download helper) past the raw cap;
// callers treat that as a permanent skip.
async function exportRawGltfModel(
  client: OnshapeClient,
  input: SyncOnshapeElementInput,
  scratchDir: string
): Promise<OnshapeModelFile> {
  const gltfTranslation =
    input.modelElementKind === "assembly"
      ? await client.createAssemblyTranslation(
          input.documentId,
          input.versionId,
          input.modelElementId,
          { formatName: "GLTF", storeInDocument: false }
        )
      : await client.createPartStudioTranslation(
          input.documentId,
          input.versionId,
          input.modelElementId,
          { formatName: "GLTF", storeInDocument: false }
        );
  const gltfDone = await waitForTranslation(client, gltfTranslation.id);
  const baseName =
    input.assetBaseName ??
    (typeof gltfDone.name === "string" ? gltfDone.name : "model");
  const foreignId = gltfDone.resultExternalDataIds?.[0];
  const resultDocumentId = gltfDone.resultDocumentId;
  if (!foreignId || !resultDocumentId) {
    throw new Error(
      `Onshape GLTF translation ${gltfDone.id} DONE but has no resultExternalDataIds/resultDocumentId`
    );
  }

  const gltfPath = join(scratchDir, "model.gltf");
  await client.downloadExternalDataToFile(
    resultDocumentId,
    foreignId,
    gltfPath,
    { maxBytes: RAW_MODEL_MAX_BYTES }
  );
  const { size } = await stat(gltfPath);
  return {
    fileName: `${baseName}.gltf`,
    localPath: gltfPath,
    size
  };
}

export async function syncOnshapeElementAssetsToItem(
  carbon: CarbonClient,
  input: SyncOnshapeElementInput
): Promise<AttachOnshapeAssetsResult & { thumbnailAttached: boolean }> {
  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(`getOnshapeClient failed: ${onshape.error ?? "no client"}`);
  }
  const client = onshape.client;

  const scratchDir = await mkdtemp(join(tmpdir(), "onshape-gltf-"));
  try {
    // Raw GLTF is the only model export (STEP was deliberately dropped — see
    // exportRawGltfModel). The assembler pipeline does the compression; the
    // caller fires "carbon/model-optimize" for the returned modelUploadId.
    // Throws OnshapeAssetTooLargeError past the raw cap; callers treat that as
    // a permanent skip.
    const model = await exportRawGltfModel(client, input, scratchDir);
    const baseName = model.fileName.replace(/\.gltf$/, "");

    // Drawings -> PDF (optional; same translation flow, not yet exercised
    // against a live DRAWING element).
    const documents: { fileName: string; bytes: Uint8Array }[] = [];
    for (const drawingElementId of input.drawingElementIds ?? []) {
      const pdfTranslation = await client.createDrawingTranslation(
        input.documentId,
        input.versionId,
        drawingElementId,
        { formatName: "PDF", storeInDocument: false }
      );
      const pdfDone = await waitForTranslation(client, pdfTranslation.id);
      const pdfBytes = await downloadTranslationBytes(
        client,
        pdfDone,
        DOCUMENT_MAX_BYTES
      );
      documents.push({
        fileName: `${baseName}-${drawingElementId}.pdf`,
        bytes: pdfBytes
      });
    }

    const attached = await attachOnshapeAssetsToItem(carbon, {
      companyId: input.companyId,
      createdBy: input.userId,
      itemId: input.itemId,
      sourceDocument: input.sourceDocument,
      model,
      documents
    });

    // Thumbnail: prefer Onshape's server-rendered element thumbnail — one small
    // API call for an exact shaded render of the released geometry, instead of
    // the model-thumbnail pipeline screenshotting the full decoded mesh in a
    // headless browser (the very operation that struggles with big assemblies).
    // Best-effort: on failure the caller falls back to the model-thumbnail event.
    let thumbnailAttached = false;
    if (attached.modelUploadId) {
      try {
        const thumbnail = await client.getElementThumbnail(
          input.documentId,
          input.versionId,
          input.modelElementId
        );
        await attachModelThumbnail(carbon, {
          companyId: input.companyId,
          modelUploadId: attached.modelUploadId,
          pngBytes: new Uint8Array(thumbnail)
        });
        thumbnailAttached = true;
      } catch (thumbnailError) {
        console.warn(
          `syncOnshapeElementAssetsToItem: Onshape thumbnail fetch failed for ${baseName}; falling back to the model-thumbnail job`,
          thumbnailError
        );
      }
    }

    return { ...attached, thumbnailAttached };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

export interface SyncOnshapeDrawingInput {
  companyId: string;
  userId: string; // Onshape integration installer (auth + audit)
  itemId: string; // resolved Carbon item (the model this drawing documents)
  sourceDocument: DocumentSourceType; // e.g. "Part"
  documentId: string;
  versionId: string; // the released version
  drawingElementId: string; // the released DRAWING element to export as PDF
  assetBaseName?: string; // filename base (e.g. the model's readableIdWithRevision)
}

// Export ONE released Onshape DRAWING element as a PDF and attach it as a document
// on the given Carbon item. Drawings are released as their own elements (DRW-xxxx,
// elementType 2) separate from the model, so the caller resolves which item the
// drawing belongs to (by shared part number) and passes it here. No model is
// touched — only a PDF document is added/updated (idempotent via the attach
// helper's replace-not-append rule).
export async function syncOnshapeDrawingAssetsToItem(
  carbon: CarbonClient,
  input: SyncOnshapeDrawingInput
): Promise<AttachOnshapeAssetsResult> {
  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(`getOnshapeClient failed: ${onshape.error ?? "no client"}`);
  }
  const client = onshape.client;

  const pdfTranslation = await client.createDrawingTranslation(
    input.documentId,
    input.versionId,
    input.drawingElementId,
    { formatName: "PDF", storeInDocument: false }
  );
  const pdfDone = await waitForTranslation(client, pdfTranslation.id);
  const pdfBytes = await downloadTranslationBytes(
    client,
    pdfDone,
    DOCUMENT_MAX_BYTES
  );
  const baseName = input.assetBaseName ?? pdfDone.name ?? "drawing";

  return attachOnshapeAssetsToItem(carbon, {
    companyId: input.companyId,
    createdBy: input.userId,
    itemId: input.itemId,
    sourceDocument: input.sourceDocument,
    documents: [{ fileName: `${baseName}.pdf`, bytes: pdfBytes }]
  });
}
