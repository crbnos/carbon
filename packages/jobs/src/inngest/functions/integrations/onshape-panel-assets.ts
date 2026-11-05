// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type {
  DrawingAssemblyElement,
  DrawingSource,
  DrawingTarget,
  OnshapeClient,
  OnshapeDrawing
} from "@carbon/ee/onshape";
import {
  getOnshapeClient,
  readDocumentDrawings,
  readDrawingReferences,
  tieDrawings
} from "@carbon/ee/onshape";
import type { OnshapeOAuthIntegrationId } from "@carbon/ee/onshape/integration-id";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import type { Events } from "@carbon/lib/events";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError, RetryAfterError } from "inngest";
import { sql } from "kysely";
import { z } from "zod";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import { packBySize } from "../events/pack";
import {
  currentModels,
  type DrawingExport,
  type DrawingPlan,
  loadDrawingRecords,
  loadModelRecords,
  modelSourceMicroversion,
  planDrawingFiles,
  readSourceStates,
  type SourceStateStamp,
  type SourceStates,
  sourceStateReads,
  sourceStateStamps,
  type TiedDrawing
} from "./onshape-asset-state";
import {
  placeDrawingFiles,
  recordDrawingSources
} from "./onshape-drawing-source";
import { withRateLimitRetry } from "./onshape-rate-limit";
import {
  ONSHAPE_CHECKPOINTING,
  runOnshapeDrawingSync,
  runOnshapeElementSync,
  type SyncOnshapeDrawingInput,
  type SyncOnshapeElementInput
} from "./onshape-sync-element";

// The STEP models of an assembly push's child rows, exported onto the items
// the push linked, and the drawing PDFs of the rows a push names: each drawing
// in the rows' documents attaches to every row it shows. A file the item
// already has from the source's current state is skipped before any export.
// Each other file runs as its own invoked `onshape-panel-asset-export`, so its
// polls and fetch are that run's steps and this run stays under the per-run
// step limit. A drawing is translated once, whatever number of rows it shows.
//
// Inngest counts executing steps against a concurrency key, and a run waiting
// in `step.invoke` holds none. So this function's own key only keeps two of its
// runs for one company from reading at once; the export function's
// per-company key is what bounds the exports of every push together.

type CarbonClient = SupabaseClient<Database>;
type AssetsPayload = Events["carbon/onshape-panel-assets"]["data"];

const EXPORTS_AT_ONCE = 2;
const MAX_CONSECUTIVE_FAILURES = 5;

const payloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  planId: z.string(),
  models: z.array(
    z.object({
      itemId: z.string(),
      externalId: z.string(),
      partNumber: z.string(),
      kind: z.enum(["partstudio", "assembly"]),
      documentId: z.string(),
      wvm: z.enum(["w", "v"]),
      wvmId: z.string(),
      elementId: z.string(),
      partId: z.string().optional(),
      configuration: z.string().nullish()
    })
  ),
  drawings: z
    .object({
      targets: z.array(
        z.object({
          itemId: z.string(),
          partNumber: z.string(),
          kind: z.enum(["partstudio", "assembly"]),
          documentId: z.string(),
          wvm: z.enum(["w", "v"]),
          wvmId: z.string(),
          elementId: z.string(),
          partId: z.string().optional(),
          configuration: z.string().nullish()
        })
      ),
      assemblies: z.array(
        z.object({
          documentId: z.string(),
          wvm: z.enum(["w", "v"]),
          wvmId: z.string(),
          elementId: z.string(),
          configuration: z.string().nullish()
        })
      ),
      skipElementIds: z.array(z.string()).optional()
    })
    .optional()
});

// Onshape reads in flight at once while finding drawings: enough to keep a
// large push's step short without a burst that trips Onshape's rate limit.
const DRAWING_READS_AT_ONCE = 4;

async function onshapeClient(
  carbon: CarbonClient,
  payload: Pick<AssetsPayload, "companyId" | "userId">
): Promise<OnshapeClient> {
  const onshape = await getOnshapeClient(
    carbon,
    payload.companyId,
    payload.userId,
    ONSHAPE_V2_INTEGRATION_ID
  );
  if (onshape.error || !onshape.client) {
    throw new Error(`getOnshapeClient failed: ${onshape.error ?? "no client"}`);
  }
  return onshape.client;
}

/** A rate limit reschedules the step; any other failed read is logged and skipped. */
async function readOrWarn<T>(
  label: string,
  read: () => Promise<T>
): Promise<T | null> {
  try {
    return await withRateLimitRetry(read, label);
  } catch (error) {
    if (error instanceof RetryAfterError) throw error;
    console.warn(`onshape-panel-assets: could not read ${label}`, error);
    return null;
  }
}

export type AssetWork = {
  models: Array<{ label: string; data: SyncOnshapeElementInput }>;
  unchanged: number;
};

/**
 * The exports to run. A model whose item is in `current` is left out: the
 * item already has it from the source's current state. A model carries its
 * workspace's source state, so the element sync names it as the part push
 * does.
 */
export function buildAssetWork(
  payload: AssetsPayload,
  states: SourceStates,
  current: string[]
): AssetWork {
  const currentItems = new Set(current);
  let unchanged = 0;
  const models: AssetWork["models"] = [];
  for (const model of payload.models) {
    if (currentItems.has(model.itemId)) {
      unchanged++;
      continue;
    }
    const microversion = modelSourceMicroversion(model, states);
    models.push({
      label: `model ${model.partNumber}`,
      data: {
        companyId: payload.companyId,
        userId: payload.userId,
        integrationId: ONSHAPE_V2_INTEGRATION_ID,
        itemId: model.itemId,
        sourceDocument: "Part",
        documentId: model.documentId,
        versionId: model.wvmId,
        sourceWvm: model.wvm,
        ...(microversion ? { sourceMicroversionId: microversion } : {}),
        modelElementId: model.elementId,
        modelElementKind: model.kind,
        ...(model.partId ? { partId: model.partId } : {}),
        ...(model.configuration ? { configuration: model.configuration } : {}),
        // As the part push names it: another name for the same source id fails
        // the attach's identity check.
        assetBaseName: model.partNumber
      }
    });
  }
  return { models, unchanged };
}

/**
 * Writes each stamp onto its item link, merged into the metadata, and only
 * where the link still names the stamp's source: one statement for every
 * stamp.
 */
async function recordSourceStates(
  companyId: string,
  userId: string,
  stamps: SourceStateStamp[]
): Promise<number> {
  if (stamps.length === 0) return 0;
  const result = await sql`
    UPDATE "externalIntegrationMapping" AS m
    SET "metadata" = COALESCE(m."metadata", '{}'::jsonb) || v."patch",
        "updatedBy" = ${userId},
        "updatedAt" = ${datetime.timestamp()}
    FROM (VALUES ${sql.join(
      stamps.map(
        (stamp) =>
          sql`(${stamp.itemId}::text, ${stamp.externalId}::text, ${JSON.stringify(stamp.patch)}::jsonb)`
      )
    )}) AS v("itemId", "externalId", "patch")
    WHERE m."companyId" = ${companyId}
      AND m."integration" = ${ONSHAPE_V2_INTEGRATION_ID}
      AND m."entityType" = 'item'
      AND m."entityId" = v."itemId"
      AND m."externalId" = v."externalId"
  `.execute(getJobDatabaseClient());
  return Number(result.numAffectedRows ?? 0);
}

/**
 * The drawing exports to run, one per drawing: its first row, then the rest,
 * each under the PDF name the plan gave it on that row.
 */
export function buildDrawingWork(
  payload: Pick<AssetsPayload, "companyId" | "userId">,
  exports: DrawingExport[]
): Array<{
  label: string;
  data: SyncOnshapeDrawingInput;
  targets: DrawingExport["targets"];
}> {
  const work: ReturnType<typeof buildDrawingWork> = [];
  for (const { drawing, targets } of exports) {
    const [first, ...rest] = targets;
    if (!first) continue;
    const nameFor = (target: DrawingExport["targets"][number]) =>
      target.fileName.replace(/\.pdf$/, "");
    work.push({
      label: `drawing ${drawing.name} (${drawing.drawingElementId})`,
      targets,
      data: {
        companyId: payload.companyId,
        userId: payload.userId,
        integrationId: ONSHAPE_V2_INTEGRATION_ID,
        itemId: first.itemId,
        sourceDocument: "Part",
        documentId: drawing.documentId,
        versionId: drawing.wvmId,
        sourceWvm: drawing.wvm,
        drawingElementId: drawing.drawingElementId,
        assetBaseName: nameFor(first),
        ...(rest.length > 0
          ? {
              moreItems: rest.map((target) => ({
                itemId: target.itemId,
                assetBaseName: nameFor(target)
              }))
            }
          : {})
      }
    });
  }
  return work;
}

/** Runs `run` over `list`, `atOnce` at a time, results in list order. */
async function inBatches<T, R>(
  list: T[],
  atOnce: number,
  run: (entry: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < list.length; start += atOnce) {
    out.push(
      ...(await Promise.all(list.slice(start, start + atOnce).map(run)))
    );
  }
  return out;
}

/**
 * The drawings in the targets' documents, each with the rows it ties to
 * (`tieDrawings`). A document or drawing Onshape did not answer for is
 * counted in `unread`; a drawing that shows none of the rows in `untied`.
 */
async function findDrawings(
  client: OnshapeClient,
  companyId: string,
  input: NonNullable<AssetsPayload["drawings"]>
): Promise<{ drawings: TiedDrawing[]; unread: number; untied: number }> {
  const rowsById = new Map(input.targets.map((row) => [row.itemId, row]));
  const targets: DrawingTarget[] = input.targets.map((row) => ({
    id: row.itemId,
    kind: row.kind,
    documentId: row.documentId,
    wvm: row.wvm,
    wvmId: row.wvmId,
    elementId: row.elementId,
    ...(row.partId ? { partId: row.partId } : {}),
    configuration: row.configuration ?? null
  }));
  const assemblies: DrawingSource[] = input.assemblies.map((source) => ({
    kind: "assembly",
    documentId: source.documentId,
    wvm: source.wvm,
    wvmId: source.wvmId,
    elementId: source.elementId,
    configuration: source.configuration ?? null
  }));
  const documents = [
    ...new Map(
      input.targets.map((row) => [
        [row.documentId, row.wvm, row.wvmId].join("\u001f"),
        { documentId: row.documentId, wvm: row.wvm, wvmId: row.wvmId }
      ])
    ).values()
  ];
  const listed = await inBatches(documents, DRAWING_READS_AT_ONCE, (document) =>
    readOrWarn(`drawings of ${document.documentId}`, () =>
      readDocumentDrawings(client, document)
    )
  );
  const skip = new Set(input.skipElementIds ?? []);
  const found = listed
    .flatMap((read) => read?.drawings ?? [])
    .filter((drawing) => !skip.has(drawing.elementId));
  // Every assembly of the documents read, so a drawing of one outside the
  // push is still an assembly's drawing.
  const assemblyElements: DrawingAssemblyElement[] = documents.flatMap(
    (document, index) =>
      (listed[index]?.assemblyElementIds ?? []).map((elementId) => ({
        ...document,
        elementId
      }))
  );
  const read = await inBatches(
    found,
    DRAWING_READS_AT_ONCE,
    async (drawing): Promise<OnshapeDrawing | null> => {
      const references = await readOrWarn(
        `what drawing ${drawing.elementId} shows`,
        () => readDrawingReferences(client, companyId, drawing)
      );
      return references ? { ...drawing, references } : null;
    }
  );
  const tied = tieDrawings(
    read.filter((drawing): drawing is OnshapeDrawing => drawing !== null),
    targets,
    assemblies,
    assemblyElements
  );
  return {
    drawings: tied.ties.map(({ drawing, targetIds }) => ({
      documentId: drawing.documentId,
      wvm: drawing.wvm,
      wvmId: drawing.wvmId,
      drawingElementId: drawing.elementId,
      name: drawing.name,
      microversionId: drawing.microversionId,
      targets: targetIds.flatMap((id) => {
        const row = rowsById.get(id);
        return row ? [row] : [];
      })
    })),
    unread:
      listed.filter((entry) => entry === null).length +
      read.filter((drawing) => drawing === null).length,
    untied: tied.skipped.length
  };
}

/**
 * One file's export: a model, or a drawing's PDF onto every row it shows.
 * Two run at a time per company, across every push, and one per item (a
 * drawing's first): a large push cannot crowd out another company's exports,
 * and two pushes of one company share its two.
 */
export const onshapePanelAssetExportFunction = inngest.createFunction(
  {
    id: "onshape-panel-asset-export",
    checkpointing: ONSHAPE_CHECKPOINTING,
    // As the element sync's: a 429 reschedules the step through
    // RetryAfterError, and each reschedule counts against this budget.
    retries: 10,
    concurrency: [
      { key: "event.data.itemId", limit: 1 },
      {
        scope: "env",
        key: "'onshape-panel-asset-export-' + event.data.companyId",
        limit: EXPORTS_AT_ONCE
      }
    ]
  },
  { event: "carbon/onshape-panel-asset-export" },
  async ({ event, step }) => {
    const carbon = getCarbonServiceRole();
    if (event.data.kind === "drawing") {
      return runOnshapeDrawingSync(
        step,
        carbon,
        {
          ...event.data.drawing,
          integrationId: event.data.drawing.integrationId as
            | OnshapeOAuthIntegrationId
            | undefined
        },
        "drawing"
      );
    }
    return runOnshapeElementSync(
      step,
      carbon,
      {
        ...event.data.model,
        integrationId: event.data.model.integrationId as
          | OnshapeOAuthIntegrationId
          | undefined
      },
      "model"
    );
  }
);

type AssetTask =
  Events["carbon/onshape-panel-asset-batch"]["data"]["tasks"][number];

type ExportCounts = { exported: number; tooLarge: number; failed: number };

export type AssetBatchResult = {
  models: ExportCounts;
  drawings: ExportCounts & { attached: number };
  /** Items whose model export landed. */
  settled: string[];
  /** Failures in a row at the end of the batch. */
  consecutiveFailures: number;
};

function emptyBatchResult(consecutiveFailures: number): AssetBatchResult {
  return {
    models: { exported: 0, tooLarge: 0, failed: 0 },
    drawings: { exported: 0, attached: 0, tooLarge: 0, failed: 0 },
    settled: [],
    consecutiveFailures
  };
}

// Per batch run: two steps an export keeps it far under Inngest's step limit
// per run, and the byte budget its invoke under the event size limit.
const TASKS_PER_BATCH = 50;
const BATCH_BYTES = 200_000;

/** A push's exports as batch runs, in order. */
export function packAssetTasks(tasks: AssetTask[]): AssetTask[][] {
  return packBySize(tasks, BATCH_BYTES, TASKS_PER_BATCH);
}

/**
 * Up to 50 of a push's exports, two at a time, each an invoked
 * `onshape-panel-asset-export`; a drawing's records are written once its PDF
 * lands. It stops after `MAX_CONSECUTIVE_FAILURES` failures in a row, counting
 * the ones the batches before it ended with.
 */
export const onshapePanelAssetBatchFunction = inngest.createFunction(
  {
    id: "onshape-panel-asset-batch",
    // Each export retries itself; a retry here replays the memoized invokes.
    retries: 3
  },
  { event: "carbon/onshape-panel-asset-batch" },
  async ({ event, step }) => {
    const { companyId, userId } = event.data;
    const tasks: AssetTask[] = event.data.tasks;
    const result = emptyBatchResult(event.data.consecutiveFailures);

    for (let start = 0; start < tasks.length; start += EXPORTS_AT_ONCE) {
      const batch = tasks.slice(start, start + EXPORTS_AT_ONCE);
      const results = await Promise.allSettled(
        batch.map((task) =>
          step.invoke(task.id, {
            function: onshapePanelAssetExportFunction,
            data:
              task.kind === "model"
                ? {
                    kind: "model" as const,
                    companyId,
                    itemId: task.data.itemId,
                    model: task.data
                  }
                : {
                    kind: "drawing" as const,
                    companyId,
                    itemId: task.data.itemId,
                    drawing: task.data
                  }
          })
        )
      );
      for (const [index, outcome] of results.entries()) {
        const task = batch[index]!;
        const counts = task.kind === "model" ? result.models : result.drawings;
        if (outcome.status === "rejected") {
          console.error(
            `onshape-panel-asset-batch: ${task.label} failed`,
            outcome.reason
          );
          counts.failed++;
          result.consecutiveFailures++;
          continue;
        }
        result.consecutiveFailures = 0;
        const tooLarge = outcome.value.tooLarge === true;
        if (tooLarge) {
          counts.tooLarge++;
        } else {
          counts.exported++;
          if (task.kind === "model" && outcome.value.modelUploadId) {
            result.settled.push(task.data.itemId);
          }
          if (task.kind === "drawing") {
            result.drawings.attached += 1 + (task.data.moreItems?.length ?? 0);
          }
        }
        // A PDF past the limit stays past it until the drawing changes, so
        // it is recorded too.
        if (task.kind === "drawing" && task.records.length > 0) {
          await step.run(`record-${task.id}`, async () => {
            try {
              await recordDrawingSources(getJobDatabaseClient(), {
                companyId,
                userId,
                entries: task.records.map((record) => ({
                  itemId: record.itemId,
                  drawingElementId: task.data.drawingElementId,
                  record: {
                    sourceKey: record.sourceKey,
                    fileName: record.fileName,
                    ...(tooLarge ? { tooLarge: true as const } : {})
                  }
                }))
              });
            } catch (error) {
              // Only an optimization: the next push exports it again.
              console.warn(
                `onshape-panel-asset-batch: could not record ${task.label}`,
                error
              );
            }
          });
        }
      }
      if (result.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
    }
    return result;
  }
);

export const onshapePanelAssetsFunction = inngest.createFunction(
  {
    id: "onshape-panel-assets",
    // As the backfill's: a 429 reschedules a read through RetryAfterError,
    // and each reschedule counts against this budget. Each export carries its own.
    retries: 10,
    concurrency: {
      scope: "env",
      key: "'onshape-panel-assets-' + event.data.companyId",
      limit: 1
    }
  },
  { event: "carbon/onshape-panel-assets" },
  async ({ event, step }) => {
    const payload = payloadSchema.parse(event.data) as AssetsPayload;
    const carbon = getCarbonServiceRole();
    const drawingTargets = payload.drawings?.targets ?? [];

    const states: SourceStates = await step.run("source-states", async () => {
      const documents = sourceStateReads([
        ...payload.models,
        ...drawingTargets
      ]);
      if (documents.length === 0) return { documents: {} };
      return readSourceStates(
        await onshapeClient(carbon, payload),
        documents,
        readOrWarn
      );
    });
    const current: string[] = await step.run("current-models", async () =>
      currentModels(
        payload.companyId,
        payload.models,
        states,
        await loadModelRecords(carbon, payload.companyId, payload.models)
      )
    );
    const work = buildAssetWork(payload, states, current);

    const found =
      payload.drawings && drawingTargets.length > 0
        ? await step.run("find-drawings", async () =>
            findDrawings(
              await onshapeClient(carbon, payload),
              payload.companyId,
              payload.drawings!
            )
          )
        : { drawings: [], unread: 0, untied: 0 };
    const pending: DrawingPlan =
      found.drawings.length === 0
        ? { exports: [], placements: [], unchanged: 0, renamed: 0 }
        : await step.run("current-drawings", async () =>
            planDrawingFiles(
              found.drawings,
              states,
              await loadDrawingRecords(
                carbon,
                getJobDatabaseClient(),
                payload.companyId,
                found.drawings
              )
            )
          );
    // Before any export: a renamed drawing's PDF moves first, so its export
    // overwrites it instead of landing beside it.
    const placed =
      pending.placements.length === 0
        ? { moved: 0, failed: 0 }
        : await step.run("place-drawings", () =>
            placeDrawingFiles(carbon, getJobDatabaseClient(), {
              companyId: payload.companyId,
              userId: payload.userId,
              placements: pending.placements
            })
          );
    const drawingWork = buildDrawingWork(payload, pending.exports);

    const tasks: AssetTask[] = [
      ...work.models.map((model, index) => ({
        kind: "model" as const,
        id: `model-${index}`,
        label: model.label,
        data: { ...model.data, sourceDocument: "Part" as const }
      })),
      ...drawingWork.map((drawing, index) => ({
        kind: "drawing" as const,
        id: `drawing-${index}`,
        label: drawing.label,
        data: { ...drawing.data, sourceDocument: "Part" as const },
        records: drawing.targets.flatMap((target) =>
          target.sourceKey
            ? [
                {
                  itemId: target.itemId,
                  sourceKey: target.sourceKey,
                  fileName: target.fileName
                }
              ]
            : []
        )
      }))
    ];

    const totals = {
      exported: 0,
      unchanged: work.unchanged,
      tooLarge: 0,
      failed: 0,
      drawings: {
        found: found.drawings.length,
        exported: 0,
        attached: 0,
        unchanged: pending.unchanged,
        renamed: pending.renamed,
        renameFailed: placed.failed,
        tooLarge: 0,
        failed: 0,
        unread: found.unread,
        untied: found.untied
      }
    };
    // Items holding their row's model from the source's current state.
    const settled = new Set(current);
    // Stamped before the run ends either way, so a part push after this one
    // reads every model in place as unchanged.
    const recordStates = () =>
      step.run("record-source-states", () =>
        recordSourceStates(
          payload.companyId,
          payload.userId,
          sourceStateStamps(payload.models, states, settled)
        )
      );
    let consecutiveFailures = 0;

    for (const [index, batch] of packAssetTasks(tasks).entries()) {
      let result: AssetBatchResult;
      try {
        result = await step.invoke(`batch-${index}`, {
          function: onshapePanelAssetBatchFunction,
          data: {
            companyId: payload.companyId,
            userId: payload.userId,
            consecutiveFailures,
            tasks: batch
          }
        });
      } catch (error) {
        console.error(`onshape-panel-assets: batch ${index} failed`, error);
        result = {
          ...emptyBatchResult(consecutiveFailures + batch.length),
          models: {
            exported: 0,
            tooLarge: 0,
            failed: batch.filter((task) => task.kind === "model").length
          },
          drawings: {
            exported: 0,
            attached: 0,
            tooLarge: 0,
            failed: batch.filter((task) => task.kind === "drawing").length
          }
        };
      }
      totals.exported += result.models.exported;
      totals.tooLarge += result.models.tooLarge;
      totals.failed += result.models.failed;
      totals.drawings.exported += result.drawings.exported;
      totals.drawings.attached += result.drawings.attached;
      totals.drawings.tooLarge += result.drawings.tooLarge;
      totals.drawings.failed += result.drawings.failed;
      for (const itemId of result.settled) settled.add(itemId);
      consecutiveFailures = result.consecutiveFailures;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await recordStates();
        // A retry replays the same memoized failures: end the run now.
        throw new NonRetriableError(
          `onshape-panel-assets: stopping after ${consecutiveFailures} consecutive failures`
        );
      }
    }

    await recordStates();
    return totals;
  }
);
