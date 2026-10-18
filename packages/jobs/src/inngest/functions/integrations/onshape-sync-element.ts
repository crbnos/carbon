// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@carbon/database";
import type { OnshapeClient, OnshapeTranslation } from "@carbon/ee/onshape";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type { OnshapeOAuthIntegrationId } from "@carbon/ee/onshape/integration-id";
import { getFileSizeLimit } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AttachOnshapeAssetsResult,
  attachModelThumbnail,
  attachOnshapeAssetsToItem,
  type OnshapeModelFile
} from "./onshape-attach";

// Export→download→attach for ONE Onshape element, released or in a workspace.
// Wires the OnshapeClient export methods (@carbon/ee) to the Carbon-side attach
// helper. Flow: create translation -> poll to DONE -> download from
// resultDocumentId/resultExternalDataIds -> attach. Poll-with-backoff (real
// completions take seconds); no translation.complete webhook needed.
//
// Callers (the release-sync and backfill jobs, and onshape-panel-sync) resolve
// itemId and the documentId/version-or-workspace/elementId of the geometry,
// including its partId and configuration. Individual-part
// thumbnails come from that selected model after optimization; an element
// thumbnail represents the entire Part Studio and must never be attached to it.

type CarbonClient = SupabaseClient<Database>;
type DocumentSourceType = Database["public"]["Enums"]["documentSourceType"];

export interface SyncOnshapeElementInput {
  companyId: string;
  userId: string; // Onshape integration installer (auth + audit)
  // Omitted: the company's active sync connection.
  integrationId?: OnshapeOAuthIntegrationId;
  itemId: string; // resolved Carbon item (caller guarantees it exists)
  sourceDocument: DocumentSourceType; // e.g. "Part"
  documentId: string;
  versionId: string; // released version, or workspace id when sourceWvm is "w"
  sourceWvm?: "w" | "v"; // path segment for export/thumbnail calls; default "v"
  // Workspace ids are mutable, so a Part Studio model id also hashes this.
  sourceMicroversionId?: string;
  modelElementId: string; // released Part Studio OR Assembly element to export
  modelElementKind: "partstudio" | "assembly"; // from the revision's elementType (0/1)
  partId?: string | null; // REQUIRED for individual Part Studio releases
  configuration?: string | null; // exact released configuration, not the current workspace
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

// The one and only model export path: export STEP from Onshape and stream it
// to disk (a whole-vehicle export can be several GB — it is never buffered in
// memory). The raw export is attached as-is, like a manual STEP upload: the
// assembler pipeline ("carbon/model-optimize", started by the new model row)
// builds the viewer GLB and compacts the raw into the company bucket, and an
// assembly instruction can convert and plan it. Throws
// OnshapeAssetTooLargeError (from the download helper) past the raw cap;
// callers treat that as a permanent skip.
async function exportStepModel(
  client: OnshapeClient,
  input: SyncOnshapeElementInput,
  scratchDir: string
): Promise<OnshapeModelFile> {
  // Missing selection previously exported the entire studio. Fail closed:
  // a release asset is one part, never an implicit list or whole-studio export.
  if (
    input.modelElementKind === "partstudio" &&
    (typeof input.partId !== "string" ||
      !input.partId.trim() ||
      /[,\s]/.test(input.partId))
  ) {
    throw new Error(
      "An individual Onshape release requires exactly one partId"
    );
  }
  if (input.configuration != null && typeof input.configuration !== "string") {
    throw new Error("Invalid released Onshape configuration");
  }
  const configuration = input.configuration ?? undefined;
  const translation =
    input.modelElementKind === "assembly"
      ? await client.createAssemblyTranslation(
          input.documentId,
          input.versionId,
          input.modelElementId,
          {
            formatName: "STEP",
            storeInDocument: false,
            configuration,
            wvm: input.sourceWvm ?? "v"
          }
        )
      : await client.createPartStudioTranslation(
          input.documentId,
          input.versionId,
          input.modelElementId,
          {
            formatName: "STEP",
            storeInDocument: false,
            configuration,
            partIds: input.partId!,
            wvm: input.sourceWvm ?? "v"
          }
        );
  const done = await waitForTranslation(client, translation.id);
  const baseName =
    input.assetBaseName ??
    (typeof done.name === "string" ? done.name : "model");
  const foreignId = done.resultExternalDataIds?.[0];
  const resultDocumentId = done.resultDocumentId;
  if (!foreignId || !resultDocumentId) {
    throw new Error(
      `Onshape STEP translation ${done.id} DONE but has no resultExternalDataIds/resultDocumentId`
    );
  }

  const stepPath = join(scratchDir, "model.step");
  await client.downloadExternalDataToFile(
    resultDocumentId,
    foreignId,
    stepPath,
    { maxBytes: RAW_MODEL_MAX_BYTES }
  );
  const { size } = await stat(stepPath);
  return {
    fileName: `${baseName}.step`,
    localPath: stepPath,
    size,
    // Immutable generation: old optimizer/thumbnail/compact jobs can only
    // finish against their old model ID. Replays of this exact released source
    // share one ID; a different part/configuration cannot reuse its artifacts.
    // A whole assembly, or a workspace part with no microversion, has no fixed
    // source to name; the attach names it by its bytes instead. The tag
    // changed with the export format: a GLTF generation of the same source
    // already holds the "selected-part-v1" id, and reusing it would fail the
    // attach's identity check.
    sourceId:
      input.modelElementKind === "partstudio" &&
      (input.sourceWvm !== "w" || input.sourceMicroversionId)
        ? `onshape-${createHash("sha256")
            .update(
              JSON.stringify([
                "selected-part-step-v1",
                input.companyId,
                input.itemId,
                input.documentId,
                input.versionId,
                input.modelElementId,
                input.partId,
                configuration ?? "",
                ...(input.sourceWvm === "w" ? [input.sourceMicroversionId] : [])
              ])
            )
            .digest("hex")
            .slice(0, 40)}`
        : undefined
  };
}

export async function syncOnshapeElementAssetsToItem(
  carbon: CarbonClient,
  input: SyncOnshapeElementInput
): Promise<AttachOnshapeAssetsResult & { thumbnailAttached: boolean }> {
  const onshape = await getOnshapeClient(
    carbon,
    input.companyId,
    input.userId,
    input.integrationId
  );
  if (onshape.error || !onshape.client) {
    throw new Error(`getOnshapeClient failed: ${onshape.error ?? "no client"}`);
  }
  const client = onshape.client;

  const scratchDir = await mkdtemp(join(tmpdir(), "onshape-step-"));
  try {
    // STEP is the only model export (see exportStepModel). The assembler
    // pipeline builds the preview and compacts the raw; a new model row
    // starts it.
    // Throws OnshapeAssetTooLargeError past the raw cap; callers treat that as
    // a permanent skip.
    const model = await exportStepModel(client, input, scratchDir);
    const baseName = model.fileName.replace(/\.step$/, "");

    // Drawings -> PDF (optional; same translation flow, not yet exercised
    // against a live DRAWING element).
    const documents: { fileName: string; bytes: Uint8Array }[] = [];
    for (const drawingElementId of input.drawingElementIds ?? []) {
      const pdfTranslation = await client.createDrawingTranslation(
        input.documentId,
        input.versionId,
        drawingElementId,
        {
          formatName: "PDF",
          storeInDocument: false,
          wvm: input.sourceWvm ?? "v"
        }
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

    // The element-thumbnail endpoint cannot select a part or configuration.
    // Keep it only for unconfigured assemblies. All other thumbnails are
    // rendered from the selected model by the optimise itself.
    let thumbnailAttached = false;
    if (
      attached.modelUploadId &&
      input.modelElementKind === "assembly" &&
      (!input.configuration || input.configuration.toLowerCase() === "default")
    ) {
      try {
        const thumbnail = await client.getElementThumbnail(
          input.documentId,
          input.versionId,
          input.modelElementId,
          "300x300",
          input.sourceWvm ?? "v"
        );
        await attachModelThumbnail(carbon, {
          companyId: input.companyId,
          modelUploadId: attached.modelUploadId,
          pngBytes: new Uint8Array(thumbnail)
        });
        thumbnailAttached = true;
      } catch (thumbnailError) {
        console.warn(
          `syncOnshapeElementAssetsToItem: Onshape thumbnail fetch failed for ${baseName}; the optimise renders one`,
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
  integrationId?: OnshapeOAuthIntegrationId;
  itemId: string; // resolved Carbon item (the model this drawing documents)
  sourceDocument: DocumentSourceType; // e.g. "Part"
  documentId: string;
  versionId: string; // the released version
  drawingElementId: string; // the released DRAWING element to export as PDF
  assetBaseName?: string; // filename base (e.g. the model's readableIdWithRevision)
  sourceWvm?: "w" | "v"; // path segment for the drawing translation; default "v"
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
  const onshape = await getOnshapeClient(
    carbon,
    input.companyId,
    input.userId,
    input.integrationId
  );
  if (onshape.error || !onshape.client) {
    throw new Error(`getOnshapeClient failed: ${onshape.error ?? "no client"}`);
  }
  const client = onshape.client;

  const pdfTranslation = await client.createDrawingTranslation(
    input.documentId,
    input.versionId,
    input.drawingElementId,
    { formatName: "PDF", storeInDocument: false, wvm: input.sourceWvm ?? "v" }
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
