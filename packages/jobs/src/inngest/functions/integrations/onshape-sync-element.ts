import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@carbon/database";
import type { OnshapeClient, OnshapeTranslation } from "@carbon/ee/onshape";
import {
  getOnshapeClient,
  OnshapeAssetTooLargeError
} from "@carbon/ee/onshape";
import { getFileSizeLimit } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AttachOnshapeAssetsResult,
  attachModelThumbnail,
  attachOnshapeAssetsToItem,
  type OnshapeAssetFile
} from "./onshape-attach";
import {
  compressGltfToViewerGlb,
  resolveGltfpackPath
} from "./onshape-compress-model";

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

// Size caps for the attached files — the SAME limits Carbon enforces on manual
// uploads (CadModel.tsx / document upload), since synced assets land in the
// same storage bucket and the same browser viewer. Models that cannot be
// compressed under the cap are skipped (drawing PDFs still attach — they are
// separate elements).
const MODEL_MAX_BYTES = getFileSizeLimit("CAD_MODEL_UPLOAD").bytes;
const DOCUMENT_MAX_BYTES = getFileSizeLimit("DOCUMENT_UPLOAD").bytes;

// Cap for the INTERMEDIATE GLTF download. It is streamed to disk (never
// buffered) and deleted after compression, so it can be far larger than the
// attach caps; a real whole-vehicle export was 1.7GB.
const GLTF_INTERMEDIATE_MAX_BYTES = 4 * 1024 * 1024 * 1024;

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

// The one and only model export path: export GLTF from Onshape, stream it to
// disk (a whole-vehicle export can be >1.5GB — it is never buffered in
// memory), compress it to a Draco GLB the viewer renders (full fidelity
// first, 50%/25% simplification if needed), and attach that. STEP export was
// deliberately dropped: real assemblies produce multi-GB STEP files, and
// Onshape stays the CAD system of record — Carbon only needs a
// viewer-renderable mesh. Throws OnshapeAssetTooLargeError when compression
// is unavailable (no native gltfpack — set GLTFPACK_PATH) or the compressed
// output still exceeds the cap; callers treat both as a permanent skip.
async function exportCompressedGlbModel(
  client: OnshapeClient,
  input: SyncOnshapeElementInput
): Promise<OnshapeAssetFile> {
  const gltfpackPath = await resolveGltfpackPath();
  if (!gltfpackPath) {
    throw new OnshapeAssetTooLargeError(
      `Model sync requires native gltfpack for GLTF→GLB compression and none is available (set GLTFPACK_PATH)`
    );
  }

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

  const scratchDir = await mkdtemp(join(tmpdir(), "onshape-glb-"));
  try {
    const gltfPath = join(scratchDir, "model.gltf");
    await client.downloadExternalDataToFile(
      resultDocumentId,
      foreignId,
      gltfPath,
      { maxBytes: GLTF_INTERMEDIATE_MAX_BYTES }
    );

    const glbPath = join(scratchDir, "model.glb");
    const compressed = await compressGltfToViewerGlb(
      gltfpackPath,
      gltfPath,
      glbPath,
      MODEL_MAX_BYTES
    );
    if (!compressed) {
      throw new OnshapeAssetTooLargeError(
        `Compressed GLB for ${baseName} still exceeds the model size limit`
      );
    }
    console.log(
      `syncOnshapeElementAssetsToItem: compressed ${baseName} to a ${Math.round(
        compressed.outputBytes / (1024 * 1024)
      )}MB GLB (simplify=${compressed.simplifyRatio ?? "none"})`
    );
    return {
      fileName: `${baseName}.glb`,
      bytes: new Uint8Array(await readFile(glbPath))
    };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
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

  // GLTF → Draco-compressed GLB is the only model export (STEP was
  // deliberately dropped — see exportCompressedGlbModel). Throws
  // OnshapeAssetTooLargeError when the model can't be compressed under the
  // cap; callers treat that as a permanent skip.
  const model = await exportCompressedGlbModel(client, input);
  const baseName = model.fileName.replace(/\.glb$/, "");

  // Drawings -> PDF (optional; same translation flow, not yet exercised against
  // a live DRAWING element).
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
