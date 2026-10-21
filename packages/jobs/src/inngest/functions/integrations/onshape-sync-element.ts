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
import { getAppUrl } from "@carbon/env";
import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { datetime, getFileSizeLimit } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError } from "inngest";
import { assemblerEnabled } from "../tasks/assembler-client";
import {
  type AttachOnshapeAssetsResult,
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
// Translations are polled with backoff (most finish in seconds); one still
// running after the quick polls waits on Onshape's translation.complete
// webhook instead (see waitForTranslations).
//
// Callers (the release-sync and backfill jobs, and onshape-panel-sync) resolve
// itemId and the documentId/version-or-workspace/elementId of the geometry,
// including its partId and configuration. Thumbnails come from the model
// optimizer, which renders one from the exported model.

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

// Waiting for a translation. Six quick polls (about 40 s of backoff) cover
// most exports at the cost they always had. One still running then registers a
// transient translation.complete webhook and waits for it, polling only every
// WEBHOOK_WAIT_MS as a fallback; without a webhook (a callback Onshape cannot
// reach) it keeps polling every POLL_MAX_DELAY_MS. A large assembly's export
// can take far longer than a few minutes, so the budget is an hour. Every wait
// is a step.sleep or step.waitForEvent, so a long wait holds nothing.
const QUICK_POLLS = 6;
const POLL_INITIAL_DELAY_MS = 2000;
const POLL_MAX_DELAY_MS = 30000;
const WEBHOOK_WAIT_MS = 5 * 60 * 1000;
const WAIT_BUDGET_MS = 60 * 60 * 1000;
const TRANSLATION_COMPLETE_EVENT = "carbon/onshape-translation-complete";

// An assembly's last export is recorded per item as a mapping row, so a push of
// an unchanged assembly reuses its model instead of exporting it again.
const MODEL_SOURCE_ENTITY_TYPE = "modelSource";

// Size caps — the SAME limits Carbon enforces on manual uploads (CadModel.tsx /
// document upload), since synced assets land in the same buckets. The raw model
// cap is the temp-staging cap (2.5GB); exports past it are skipped permanently
// (drawing PDFs still attach — they are separate elements). Output size is the
// assembler's problem, not ours.
const DOCUMENT_MAX_BYTES = getFileSizeLimit("DOCUMENT_UPLOAD").bytes;

/**
 * Checkpointing for the functions that run this pipeline: consecutive steps
 * (existing → translate → first poll; drawings → attach) run in
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
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: number; if: string }
  ) => Promise<unknown>;
  invoke: (
    id: string,
    opts: { function: typeof onshapeFetchFunction; data: OnshapeFetchInput }
  ) => Promise<any>;
};

export type ElementSyncResult = AttachOnshapeAssetsResult & {
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
 * 1. `existing`  — a released part's model id is known before any export, and
 *    an assembly's source (version, or workspace microversion) is compared with
 *    the one its item's current model came from; when the model already exists
 *    the export is skipped entirely.
 * 2. `translate` — start the model and every drawing translation at once.
 * 3. `poll-n` / `sleep-n` / `webhook` / `wait-n` — wait for all of them;
 *    nothing holds a function between polls.
 * 4. `fetch`     — the assembler copies the STEP straight from Onshape into
 *    temp-staging (`fetch` action), so the export never passes through this
 *    process. With no assembler configured, one step downloads and stages it.
 * 5. `drawings`  — download and attach the PDFs.
 * 6. `attach`    — move the staged STEP to its model key, insert the
 *    `modelUpload` row (which starts the optimise, and its thumbnail) and link
 *    the item.
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
    assemblySource?: string | null;
    existing: { id: string; name: string | null } | null;
  } = await step.run(`${prefix}-existing`, async () => {
    assertSelection(input);
    const sourceId = partSourceId(input);
    if (!sourceId) {
      const assemblySource = await assemblySourceKey(carbon, input, label);
      return {
        sourceId: null,
        assemblySource,
        existing: assemblySource
          ? await currentModelFromSource(carbon, input, assemblySource)
          : null
      };
    }
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
    async () => {
      const result = await attachOnshapeAssetsToItem(carbon, {
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
      });
      if (staged && planned.assemblySource && result.modelUploadId) {
        await recordModelSource(
          carbon,
          input,
          planned.assemblySource,
          result.modelUploadId
        );
      }
      return result;
    }
  );

  return {
    ...attached,
    documentIds: [...drawingDocumentIds, ...attached.documentIds]
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

/**
 * What an assembly export is made from: the released version, or the
 * workspace's current microversion, which changes on any edit to the document
 * (an assembly's own microversion would miss an edit to a part it uses). Null
 * for a part (named by partSourceId), or when the microversion cannot be read:
 * the sync then exports as before.
 */
async function assemblySourceKey(
  carbon: CarbonClient,
  input: SyncOnshapeElementInput,
  label: string
): Promise<string | null> {
  if (input.modelElementKind !== "assembly") return null;
  let state = input.versionId;
  if (input.sourceWvm === "w") {
    try {
      const client = await onshapeClient(carbon, input);
      state = await client.getCurrentMicroversion(
        input.documentId,
        input.versionId
      );
    } catch (error) {
      console.warn(
        `onshape sync: could not read the microversion of ${label}; exporting`,
        error
      );
      return null;
    }
  }
  return createHash("sha256")
    .update(
      JSON.stringify([
        "assembly-source-v1",
        input.documentId,
        input.sourceWvm ?? "v",
        state,
        input.modelElementId,
        input.configuration ?? ""
      ])
    )
    .digest("hex");
}

/** The item's current model, when it was exported from `source`. */
async function currentModelFromSource(
  carbon: CarbonClient,
  input: SyncOnshapeElementInput,
  source: string
): Promise<{ id: string; name: string | null } | null> {
  const [mapping, item] = await Promise.all([
    carbon
      .from("externalIntegrationMapping")
      .select("externalId, metadata")
      .eq("entityType", MODEL_SOURCE_ENTITY_TYPE)
      .eq("entityId", input.itemId)
      .eq("integration", modelSourceIntegration(input))
      .eq("companyId", input.companyId)
      .maybeSingle(),
    carbon
      .from("item")
      .select("modelUploadId")
      .eq("id", input.itemId)
      .eq("companyId", input.companyId)
      .maybeSingle()
  ]);
  if (mapping.error || item.error) {
    throw new Error(
      `model source lookup failed: ${(mapping.error ?? item.error)!.message}`
    );
  }
  const modelUploadId = (
    mapping.data?.metadata as { modelUploadId?: unknown } | null
  )?.modelUploadId;
  if (
    mapping.data?.externalId !== source ||
    typeof modelUploadId !== "string" ||
    item.data?.modelUploadId !== modelUploadId
  ) {
    return null;
  }
  const model = await carbon
    .from("modelUpload")
    .select("id, name")
    .eq("id", modelUploadId)
    .eq("companyId", input.companyId)
    .maybeSingle();
  if (model.error) {
    throw new Error(`existing model lookup failed: ${model.error.message}`);
  }
  return model.data ? { id: model.data.id, name: model.data.name } : null;
}

/** Remember which source the item's new model came from. Only an
 *  optimization: a failed write means the next push exports again. */
async function recordModelSource(
  carbon: CarbonClient,
  input: SyncOnshapeElementInput,
  source: string,
  modelUploadId: string
): Promise<void> {
  const written = await carbon.from("externalIntegrationMapping").upsert(
    {
      entityType: MODEL_SOURCE_ENTITY_TYPE,
      entityId: input.itemId,
      integration: modelSourceIntegration(input),
      externalId: source,
      allowDuplicateExternalId: true,
      metadata: { modelUploadId },
      companyId: input.companyId,
      createdBy: input.userId,
      updatedAt: datetime.timestamp()
    },
    { onConflict: "entityType,entityId,integration,companyId" }
  );
  if (written.error) {
    console.warn(
      `onshape sync: could not record the model source of ${input.itemId}`,
      written.error
    );
  }
}

function modelSourceIntegration(input: OnshapeCredentials): string {
  return input.integrationId ?? "onshape";
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

/**
 * Wait for every translation together until all are done. The first
 * QUICK_POLLS polls back off from 2 s. A translation still running after them
 * registers a transient, document-scoped translation.complete webhook, polls
 * once more (one may have finished before the webhook existed), then waits for
 * the webhook with a poll every WEBHOOK_WAIT_MS. The webhook only wakes the run:
 * a poll reads the result, so a forged event can do no more than cause a poll.
 * A failed translation, or an hour without finishing, fails the sync.
 */
async function waitForTranslations(
  step: Pick<ElementSyncStep, "run" | "sleep" | "waitForEvent">,
  carbon: CarbonClient,
  input: OnshapeCredentials & { documentId: string },
  label: string,
  prefix: string,
  ids: string[]
): Promise<Record<string, FinishedTranslation>> {
  const finished: Record<string, FinishedTranslation> = {};
  let delay = POLL_INITIAL_DELAY_MS;
  let startedAt: number | null = null;
  // undefined: not tried yet; null: tried, and none could be registered.
  let webhookId: string | null | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      const waiting = ids.filter((id) => !finished[id]);
      if (waiting.length === 0) return finished;
      const poll: { at: number; translations: (FinishedTranslation | null)[] } =
        await step.run(`${prefix}-poll-${attempt}`, () =>
          withRateLimitRetry(async () => {
            const client = await onshapeClient(carbon, input);
            const translations = await Promise.all(
              waiting.map(async (id) =>
                finishedTranslation(await client.getTranslation(id))
              )
            );
            return { at: Date.now(), translations };
          }, `poll ${label}`)
        );
      for (const translation of poll.translations) {
        if (translation) finished[translation.id] = translation;
      }
      if (ids.every((id) => finished[id])) return finished;

      startedAt ??= poll.at;
      if (poll.at - startedAt >= WAIT_BUDGET_MS) {
        throw new NonRetriableError(
          `Onshape translations ${ids.filter((id) => !finished[id]).join(", ")} did not finish within an hour`
        );
      }

      if (attempt + 1 >= QUICK_POLLS && webhookId === undefined) {
        webhookId = await step.run(`${prefix}-webhook`, () =>
          registerTranslationWebhook(carbon, input, label)
        );
        if (webhookId) continue;
      }

      const condition = webhookId
        ? translationEventCondition(input, ids)
        : null;
      if (condition) {
        await step.waitForEvent(`${prefix}-wait-${attempt}`, {
          event: TRANSLATION_COMPLETE_EVENT,
          timeout: WEBHOOK_WAIT_MS,
          if: condition
        });
      } else {
        await step.sleep(`${prefix}-sleep-${attempt}`, delay);
        delay = Math.min(delay * 1.5, POLL_MAX_DELAY_MS);
      }
    }
  } finally {
    if (webhookId) {
      const id = webhookId;
      await step.run(`${prefix}-unwebhook`, () =>
        deleteTranslationWebhook(carbon, input, id, label)
      );
    }
  }
}

/** Register a webhook for this document's translation.complete events.
 *  Never throws: without one the sync keeps polling. */
async function registerTranslationWebhook(
  carbon: CarbonClient,
  input: OnshapeCredentials & { documentId: string },
  label: string
): Promise<string | null> {
  try {
    const client = await onshapeClient(carbon, input);
    const webhook = await client.createWebhook({
      url: `${getAppUrl()}/api/webhook/onshape/${input.companyId}`,
      events: ["onshape.model.translation.complete"],
      documentId: input.documentId,
      isTransient: true
    });
    return webhook.id;
  } catch (error) {
    console.warn(
      `onshape sync: no translation webhook for ${label}; polling`,
      error
    );
    return null;
  }
}

/** Best-effort: Onshape removes a transient webhook on its own when idle. */
async function deleteTranslationWebhook(
  carbon: CarbonClient,
  input: OnshapeCredentials,
  webhookId: string,
  label: string
): Promise<void> {
  try {
    const client = await onshapeClient(carbon, input);
    await client.deleteWebhook(webhookId);
  } catch (error) {
    console.warn(
      `onshape sync: could not delete the translation webhook for ${label}`,
      error
    );
  }
}

/** The `if` expression matching this company's translations. Null (poll
 *  instead) for an id that is not plain alphanumeric, since it is interpolated. */
export function translationEventCondition(
  input: Pick<OnshapeCredentials, "companyId">,
  ids: string[]
): string | null {
  const safe = /^[A-Za-z0-9_-]+$/;
  if (!safe.test(input.companyId) || !ids.every((id) => safe.test(id))) {
    return null;
  }
  const translations = ids
    .map((id) => `async.data.translationId == "${id}"`)
    .join(" || ");
  return `async.data.companyId == "${input.companyId}" && (${translations})`;
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
// `translate`, the translation wait (holding no function in between), then
// `attach` (download the PDF and record it). Drawings are released as their own
// elements (DRW-xxxx, elementType 2) separate from the model, so the caller
// resolves which item the drawing belongs to (by shared part number) and passes
// it here. No model is touched — only a PDF document is added/updated
// (idempotent via the attach helper's replace-not-append rule).
export async function runOnshapeDrawingSync(
  step: Pick<ElementSyncStep, "run" | "sleep" | "waitForEvent">,
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
