// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@carbon/database";
import type { OnshapeClient, OnshapeTranslation } from "@carbon/ee/onshape";
import {
  getOnshapeClient,
  OnshapeAssetTooLargeError
} from "@carbon/ee/onshape";
import type { OnshapeOAuthIntegrationId } from "@carbon/ee/onshape/integration-id";
import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { getFileSizeLimit } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError } from "inngest";
import { assemblerEnabled } from "../tasks/assembler-client";
import {
  type AttachOnshapeAssetsResult,
  attachModelThumbnail,
  attachOnshapeAssetsToItem
} from "./onshape-attach";
import {
  type OnshapeFetchInput,
  onshapeFetchFunction,
  RAW_MODEL_MAX_BYTES,
  type StagedModel
} from "./onshape-fetch";
import { withRateLimitRetry } from "./onshape-rate-limit";

// Export→stage→attach for ONE Onshape element, released or in a workspace
// (`runOnshapeElementSync`), and the PDF export of one released drawing.
// Poll-with-backoff (real completions take seconds); no translation.complete
// webhook needed.
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
const DOCUMENT_MAX_BYTES = getFileSizeLimit("DOCUMENT_UPLOAD").bytes;

/**
 * Checkpointing for the functions that run this pipeline: consecutive steps
 * (existing → translate → first poll; drawings → attach → thumbnail) run in
 * one request instead of a round trip each. Every step here is a short Onshape
 * call or storage move. `maxRuntime` is far below the ERP's 300 s Vercel limit
 * because a step that starts at the end of the window gets only the rest of
 * the request: at 60 s a late step still has ~240 s. Not set client-wide,
 * where single steps run for minutes (MRP per company, backups).
 */
export const ONSHAPE_CHECKPOINTING = { maxRuntime: "60s" } as const;

/** The Inngest step tools the pipeline needs. */
export type ElementSyncStep = {
  run: (id: string, fn: () => unknown) => Promise<any>;
  sleep: (id: string, duration: number) => Promise<unknown>;
  invoke: (
    id: string,
    opts: { function: typeof onshapeFetchFunction; data: OnshapeFetchInput }
  ) => Promise<any>;
};

export type ElementSyncResult = AttachOnshapeAssetsResult & {
  thumbnailAttached: boolean;
  /** The export is past Carbon's upload limit: a permanent skip, not a fault. */
  tooLarge?: boolean;
};

/** A translation Onshape finished: where its result downloads from. */
type FinishedTranslation = {
  id: string;
  documentId: string;
  foreignId: string;
  name: string | null;
};

/**
 * Export one element's model (and any drawings) from Onshape onto an item, as
 * resumable steps:
 *
 * 1. `existing`  — a released part's model id is known before any export; when
 *    that model already exists the export is skipped entirely.
 * 2. `translate` — start the model and every drawing translation at once.
 * 3. `poll-n` / `sleep-n` — wait for all of them; nothing holds a function
 *    between polls.
 * 4. `fetch`     — the assembler copies the STEP straight from Onshape into
 *    temp-staging (`fetch` action), so the export never passes through this
 *    process. With no assembler configured, one step downloads and stages it.
 * 5. `drawings`  — download and attach the PDFs.
 * 6. `attach`    — move the staged STEP to its model key, insert the
 *    `modelUpload` row (which starts the optimise) and link the item.
 * 7. `thumbnail` — Onshape's own thumbnail, for an unconfigured assembly.
 *
 * A retry resumes at the step that failed, so a late failure never re-runs a
 * translation (Onshape's API quota is yearly). Step ids are namespaced by
 * `prefix`. The STEP is what a manual upload is: the assembler builds the
 * viewer GLB, compaction keeps the original in the company bucket, and an
 * assembly instruction can convert and plan it.
 */
export async function runOnshapeElementSync(
  step: ElementSyncStep,
  carbon: CarbonClient,
  input: SyncOnshapeElementInput,
  prefix: string
): Promise<ElementSyncResult> {
  const label = input.assetBaseName ?? input.modelElementId;

  const planned: {
    sourceId: string | null;
    existing: { id: string; name: string | null } | null;
  } = await step.run(`${prefix}-existing`, async () => {
    assertSelection(input);
    const sourceId = partSourceId(input);
    if (!sourceId) return { sourceId: null, existing: null };
    const row = await carbon
      .from("modelUpload")
      .select("id, name")
      .eq("id", sourceId)
      .eq("companyId", input.companyId)
      .maybeSingle();
    if (row.error) {
      throw new Error(`existing model lookup failed: ${row.error.message}`);
    }
    return {
      sourceId,
      existing: row.data ? { id: row.data.id, name: row.data.name } : null
    };
  });

  const started: {
    model: string | null;
    drawings: { elementId: string; id: string }[];
  } = await step.run(`${prefix}-translate`, () =>
    withRateLimitRetry(async () => {
      const client = await onshapeClient(carbon, input);
      const [model, drawings] = await Promise.all([
        planned.existing ? null : startModelTranslation(client, input),
        Promise.all(
          (input.drawingElementIds ?? []).map(async (elementId) => ({
            elementId,
            id: (
              await client.createDrawingTranslation(
                input.documentId,
                input.versionId,
                elementId,
                {
                  formatName: "PDF",
                  storeInDocument: false,
                  wvm: input.sourceWvm ?? "v"
                }
              )
            ).id
          }))
        )
      ]);
      return { model: model?.id ?? null, drawings };
    }, `translate ${label}`)
  );

  const finished = await waitForTranslations(
    step,
    carbon,
    input,
    label,
    prefix,
    [started.model, ...started.drawings.map((d) => d.id)].flatMap((id) =>
      id ? [id] : []
    )
  );

  const modelTranslation = started.model ? finished[started.model] : null;
  const baseName =
    input.assetBaseName ??
    modelTranslation?.name ??
    planned.existing?.name?.replace(/\.step$/i, "") ??
    "model";

  let staged: StagedModel | null = null;
  if (modelTranslation) {
    const stagedPath = `${input.companyId}/models/onshape-fetch-${modelTranslation.id}.step`;
    // The fetch runs as its own `onshape-fetch` run: it alone holds the
    // shared assembler concurrency, not this run's Onshape polls.
    const fetched: StagedModel | { tooLarge: true } = assemblerEnabled()
      ? await step.invoke(`${prefix}-fetch`, {
          function: onshapeFetchFunction,
          data: {
            companyId: input.companyId,
            userId: input.userId,
            integrationId: input.integrationId,
            translationId: modelTranslation.id,
            documentId: modelTranslation.documentId,
            foreignId: modelTranslation.foreignId,
            stagedPath
          }
        })
      : await step.run(`${prefix}-download`, () =>
          withRateLimitRetry(
            () =>
              downloadToStaging(carbon, input, modelTranslation, stagedPath),
            `download ${label}`
          )
        );
    if ("tooLarge" in fetched) {
      console.warn(`onshape sync: skipping oversized model ${label}`);
      return {
        modelUploadId: null,
        documentIds: [],
        preservedPriorModelAsDocument: false,
        thumbnailAttached: false,
        tooLarge: true
      };
    }
    staged = fetched;
  }

  const drawingDocumentIds: string[] =
    started.drawings.length === 0
      ? []
      : await step.run(`${prefix}-drawings`, () =>
          withRateLimitRetry(async () => {
            const client = await onshapeClient(carbon, input);
            const documents = (
              await Promise.all(
                started.drawings.map(async ({ elementId, id }) => {
                  const pdf = await downloadPdf(client, finished[id]!);
                  return pdf
                    ? [{ fileName: `${baseName}-${elementId}.pdf`, bytes: pdf }]
                    : [];
                })
              )
            ).flat();
            if (documents.length === 0) return [];
            const attached = await attachOnshapeAssetsToItem(carbon, {
              companyId: input.companyId,
              createdBy: input.userId,
              itemId: input.itemId,
              sourceDocument: input.sourceDocument,
              documents
            });
            return attached.documentIds;
          }, `drawings ${label}`)
        );

  const attached: AttachOnshapeAssetsResult = await step.run(
    `${prefix}-attach`,
    () =>
      attachOnshapeAssetsToItem(carbon, {
        companyId: input.companyId,
        createdBy: input.userId,
        itemId: input.itemId,
        sourceDocument: input.sourceDocument,
        ...(staged
          ? {
              model: {
                fileName: `${baseName}.step`,
                ...staged,
                sourceId: planned.sourceId ?? undefined
              }
            }
          : { existingModelId: planned.existing!.id })
      })
  );

  // The element-thumbnail endpoint cannot select a part or configuration.
  // Keep it only for a new model of an unconfigured assembly. All other
  // thumbnails are rendered from the selected model by the optimise itself.
  const thumbnailAttached: boolean =
    attached.modelUploadId !== null &&
    staged !== null &&
    input.modelElementKind === "assembly" &&
    (!input.configuration || input.configuration.toLowerCase() === "default")
      ? await step.run(`${prefix}-thumbnail`, () =>
          attachOnshapeThumbnail(carbon, input, attached.modelUploadId!, label)
        )
      : false;

  return {
    ...attached,
    documentIds: [...drawingDocumentIds, ...attached.documentIds],
    thumbnailAttached
  };
}

/** Who the Onshape calls are made as. */
type OnshapeCredentials = Pick<
  SyncOnshapeElementInput,
  "companyId" | "userId" | "integrationId"
>;

async function onshapeClient(
  carbon: CarbonClient,
  input: OnshapeCredentials
): Promise<OnshapeClient> {
  const onshape = await getOnshapeClient(
    carbon,
    input.companyId,
    input.userId,
    input.integrationId
  );
  if (onshape.error || !onshape.client) {
    throw new Error(`getOnshapeClient failed: ${onshape.error ?? "no client"}`);
  }
  return onshape.client;
}

// Missing selection previously exported the entire studio. Fail closed: a
// release asset is one part, never an implicit list or whole-studio export.
function assertSelection(input: SyncOnshapeElementInput) {
  if (
    input.modelElementKind === "partstudio" &&
    (typeof input.partId !== "string" ||
      !input.partId.trim() ||
      /[,\s]/.test(input.partId))
  ) {
    throw new NonRetriableError(
      "An individual Onshape release requires exactly one partId"
    );
  }
  if (input.configuration != null && typeof input.configuration !== "string") {
    throw new NonRetriableError("Invalid released Onshape configuration");
  }
}

// Immutable generation: old optimizer/thumbnail/compact jobs can only finish
// against their old model ID. Replays of this exact released source share one
// ID; a different part/configuration cannot reuse its artifacts. A whole
// assembly, or a workspace part with no microversion, has no fixed source to
// name; the attach names it by its bytes instead. The tag changed with the
// export format: a GLTF generation of the same source already holds the
// "selected-part-v1" id, and reusing it would fail the attach's identity check.
export function partSourceId(input: SyncOnshapeElementInput): string | null {
  if (
    input.modelElementKind !== "partstudio" ||
    (input.sourceWvm === "w" && !input.sourceMicroversionId)
  ) {
    return null;
  }
  return `onshape-${createHash("sha256")
    .update(
      JSON.stringify([
        "selected-part-step-v1",
        input.companyId,
        input.itemId,
        input.documentId,
        input.versionId,
        input.modelElementId,
        input.partId,
        input.configuration ?? "",
        ...(input.sourceWvm === "w" ? [input.sourceMicroversionId] : [])
      ])
    )
    .digest("hex")
    .slice(0, 40)}`;
}

function startModelTranslation(
  client: OnshapeClient,
  input: SyncOnshapeElementInput
) {
  const options = {
    formatName: "STEP" as const,
    storeInDocument: false,
    configuration: input.configuration ?? undefined,
    wvm: input.sourceWvm ?? "v"
  };
  return input.modelElementKind === "assembly"
    ? client.createAssemblyTranslation(
        input.documentId,
        input.versionId,
        input.modelElementId,
        options
      )
    : client.createPartStudioTranslation(
        input.documentId,
        input.versionId,
        input.modelElementId,
        { ...options, partIds: input.partId! }
      );
}

/** Poll every translation together until all are done, sleeping (as a step,
 *  holding nothing) between polls. A failed translation fails the sync. */
async function waitForTranslations(
  step: Pick<ElementSyncStep, "run" | "sleep">,
  carbon: CarbonClient,
  input: OnshapeCredentials,
  label: string,
  prefix: string,
  ids: string[]
): Promise<Record<string, FinishedTranslation>> {
  const finished: Record<string, FinishedTranslation> = {};
  let delay = POLL_INITIAL_DELAY_MS;
  for (let attempt = 0; ; attempt++) {
    const waiting = ids.filter((id) => !finished[id]);
    if (waiting.length === 0) return finished;
    if (attempt >= POLL_MAX_ATTEMPTS) {
      throw new NonRetriableError(
        `Onshape translations ${waiting.join(", ")} did not finish after ${POLL_MAX_ATTEMPTS} polls`
      );
    }
    const polled: (FinishedTranslation | null)[] = await step.run(
      `${prefix}-poll-${attempt}`,
      () =>
        withRateLimitRetry(async () => {
          const client = await onshapeClient(carbon, input);
          return Promise.all(
            waiting.map(async (id) =>
              finishedTranslation(await client.getTranslation(id))
            )
          );
        }, `poll ${label}`)
    );
    for (const translation of polled) {
      if (translation) finished[translation.id] = translation;
    }
    if (ids.every((id) => finished[id])) return finished;
    await step.sleep(`${prefix}-sleep-${attempt}`, delay);
    delay = Math.min(delay * 1.5, POLL_MAX_DELAY_MS);
  }
}

function finishedTranslation(
  translation: OnshapeTranslation
): FinishedTranslation | null {
  if (translation.requestState === "FAILED") {
    throw new NonRetriableError(
      `Onshape translation ${translation.id} FAILED: ${translation.failureReason ?? "unknown"}`
    );
  }
  if (translation.requestState !== "DONE") return null;
  const foreignId = translation.resultExternalDataIds?.[0];
  const documentId = translation.resultDocumentId;
  if (!foreignId || !documentId) {
    throw new NonRetriableError(
      `Onshape translation ${translation.id} DONE but has no resultExternalDataIds/resultDocumentId`
    );
  }
  return {
    id: translation.id,
    documentId,
    foreignId,
    name: typeof translation.name === "string" ? translation.name : null
  };
}

/** No assembler configured: download the export here and stage it. Hashes the
 *  bytes as they are read back for the upload, so the file is read once. */
async function downloadToStaging(
  carbon: CarbonClient,
  input: SyncOnshapeElementInput,
  translation: FinishedTranslation,
  stagedPath: string
): Promise<StagedModel | { tooLarge: true }> {
  const client = await onshapeClient(carbon, input);
  const scratchDir = await mkdtemp(join(tmpdir(), "onshape-step-"));
  try {
    const localPath = join(scratchDir, "model.step");
    try {
      await client.downloadExternalDataToFile(
        translation.documentId,
        translation.foreignId,
        localPath,
        { maxBytes: RAW_MODEL_MAX_BYTES }
      );
    } catch (error) {
      if (error instanceof OnshapeAssetTooLargeError) return { tooLarge: true };
      throw error;
    }
    const { size } = await stat(localPath);
    const hash = createHash("sha256");
    const blob = await openAsBlob(localPath, { type: "application/step" });
    const reader = blob.stream().getReader();
    for (
      let read = await reader.read();
      !read.done;
      read = await reader.read()
    ) {
      hash.update(read.value);
    }
    const uploaded = await carbon.storage
      .from(TEMP_STAGING_BUCKET)
      .upload(stagedPath, blob, {
        upsert: true,
        contentType: "application/step"
      });
    if (uploaded.error) {
      throw new Error(`staging the model failed: ${uploaded.error.message}`);
    }
    return { stagedPath, size, contentHash: `sha256:${hash.digest("hex")}` };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

/** A drawing's PDF, or null (logged) when it is past the document limit. */
async function downloadPdf(
  client: OnshapeClient,
  translation: FinishedTranslation
): Promise<Uint8Array | null> {
  try {
    const buffer = await client.downloadExternalData(
      translation.documentId,
      translation.foreignId,
      { maxBytes: DOCUMENT_MAX_BYTES }
    );
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof OnshapeAssetTooLargeError) {
      console.warn(
        `onshape sync: skipping oversized drawing ${translation.id}`
      );
      return null;
    }
    throw error;
  }
}

async function attachOnshapeThumbnail(
  carbon: CarbonClient,
  input: SyncOnshapeElementInput,
  modelUploadId: string,
  label: string
): Promise<boolean> {
  try {
    const client = await onshapeClient(carbon, input);
    const thumbnail = await client.getElementThumbnail(
      input.documentId,
      input.versionId,
      input.modelElementId,
      "300x300",
      input.sourceWvm ?? "v"
    );
    await attachModelThumbnail(carbon, {
      companyId: input.companyId,
      modelUploadId,
      pngBytes: new Uint8Array(thumbnail)
    });
    return true;
  } catch (thumbnailError) {
    console.warn(
      `onshape sync: Onshape thumbnail fetch failed for ${label}; the optimise renders one`,
      thumbnailError
    );
    return false;
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

export type DrawingSyncResult = AttachOnshapeAssetsResult & {
  /** The PDF is past the document upload limit: a permanent skip. */
  tooLarge?: boolean;
};

// Export ONE released Onshape DRAWING element as a PDF and attach it as a document
// on the given Carbon item, as resumable steps like the element sync's:
// `translate`, `poll-n` / `sleep-n` (holding no function between polls), then
// `attach` (download the PDF and record it). Drawings are released as their own
// elements (DRW-xxxx, elementType 2) separate from the model, so the caller
// resolves which item the drawing belongs to (by shared part number) and passes
// it here. No model is touched — only a PDF document is added/updated
// (idempotent via the attach helper's replace-not-append rule).
export async function runOnshapeDrawingSync(
  step: Pick<ElementSyncStep, "run" | "sleep">,
  carbon: CarbonClient,
  input: SyncOnshapeDrawingInput,
  prefix: string
): Promise<DrawingSyncResult> {
  const label = input.assetBaseName ?? input.drawingElementId;
  const translationId: string = await step.run(`${prefix}-translate`, () =>
    withRateLimitRetry(async () => {
      const client = await onshapeClient(carbon, input);
      const translation = await client.createDrawingTranslation(
        input.documentId,
        input.versionId,
        input.drawingElementId,
        {
          formatName: "PDF",
          storeInDocument: false,
          wvm: input.sourceWvm ?? "v"
        }
      );
      return translation.id;
    }, `translate ${label}`)
  );
  const finished = await waitForTranslations(
    step,
    carbon,
    input,
    label,
    prefix,
    [translationId]
  );
  const translation = finished[translationId]!;

  return step.run(`${prefix}-attach`, () =>
    withRateLimitRetry(async (): Promise<DrawingSyncResult> => {
      const client = await onshapeClient(carbon, input);
      const pdf = await downloadPdf(client, translation);
      if (!pdf) {
        return {
          modelUploadId: null,
          documentIds: [],
          preservedPriorModelAsDocument: false,
          tooLarge: true
        };
      }
      const baseName = input.assetBaseName ?? translation.name ?? "drawing";
      return attachOnshapeAssetsToItem(carbon, {
        companyId: input.companyId,
        createdBy: input.userId,
        itemId: input.itemId,
        sourceDocument: input.sourceDocument,
        documents: [{ fileName: `${baseName}.pdf`, bytes: pdf }]
      });
    }, `attach ${label}`)
  );
}
