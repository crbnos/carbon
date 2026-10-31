// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { OnshapeClient } from "@carbon/ee/onshape";
import { getOnshapeClient } from "@carbon/ee/onshape";
import type { OnshapeOAuthIntegrationId } from "@carbon/ee/onshape/integration-id";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import type { Events } from "@carbon/lib/events";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError, RetryAfterError } from "inngest";
import { z } from "zod";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import {
  currentFiles,
  drawingAssetBaseName,
  drawingFileKey,
  drawingRowSourceKey,
  loadFileRecords,
  modelSourceMicroversion,
  readSourceStates,
  type SourceStates,
  sourceStateReads
} from "./onshape-asset-state";
import { recordDrawingSource } from "./onshape-drawing-source";
import { withRateLimitRetry } from "./onshape-rate-limit";
import {
  ONSHAPE_CHECKPOINTING,
  runOnshapeDrawingSync,
  runOnshapeElementSync,
  type SyncOnshapeDrawingInput,
  type SyncOnshapeElementInput
} from "./onshape-sync-element";

// The STEP models and drawing PDFs an assembly push's reviewer picked, exported
// onto the items the push linked. A file the item already has from the
// source's current state is skipped before any export. Each other file runs as
// its own invoked `onshape-panel-asset-export`, so its polls and fetch are
// that run's steps and this run stays under the per-run step limit.
//
// Inngest counts executing steps against a concurrency key, and a run waiting
// in `step.invoke` holds none. So this function's own key only keeps two of its
// runs for one company from reading at once; the export function's
// per-company key is what bounds the exports of every push together.

type CarbonClient = SupabaseClient<Database>;
type AssetsPayload = Events["carbon/onshape-panel-assets"]["data"];

const EXPORTS_AT_ONCE = 2;
const MAX_CONSECUTIVE_FAILURES = 5;

const sourceSchema = z.object({
  kind: z.enum(["partstudio", "assembly"]),
  documentId: z.string(),
  wvm: z.enum(["w", "v"]),
  wvmId: z.string(),
  elementId: z.string(),
  partId: z.string().optional(),
  configuration: z.string().nullish()
});

const payloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  planId: z.string(),
  models: z.array(
    sourceSchema.extend({ itemId: z.string(), partNumber: z.string() })
  ),
  drawings: z.array(
    z.object({
      itemId: z.string(),
      partNumber: z.string(),
      documentId: z.string(),
      wvm: z.enum(["w", "v"]),
      wvmId: z.string(),
      drawingElementId: z.string(),
      drawingMicroversionId: z.string().nullish(),
      target: sourceSchema
    })
  )
});

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
  drawings: Array<{
    label: string;
    data: SyncOnshapeDrawingInput;
    sourceKey: string | null;
  }>;
  unchangedModels: number;
  unchangedDrawings: number;
};

/**
 * The exports to run. A file in `current` is left out: its item already has
 * it from the source's current state. A model carries its workspace's source
 * state, so the element sync names it as the part push does.
 */
export function buildAssetWork(
  payload: AssetsPayload,
  states: SourceStates,
  current: { models: string[]; drawings: string[] }
): AssetWork {
  const currentModels = new Set(current.models);
  const currentDrawings = new Set(current.drawings);
  let unchangedModels = 0;
  const models: AssetWork["models"] = [];
  for (const model of payload.models) {
    if (currentModels.has(model.itemId)) {
      unchangedModels++;
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

  let unchangedDrawings = 0;
  const drawings: AssetWork["drawings"] = [];
  for (const drawing of payload.drawings) {
    if (currentDrawings.has(drawingFileKey(drawing))) {
      unchangedDrawings++;
      continue;
    }
    drawings.push({
      label: `drawing ${drawing.drawingElementId} of ${drawing.partNumber}`,
      sourceKey: drawingRowSourceKey(drawing, states),
      data: {
        companyId: payload.companyId,
        userId: payload.userId,
        integrationId: ONSHAPE_V2_INTEGRATION_ID,
        itemId: drawing.itemId,
        sourceDocument: "Part",
        documentId: drawing.documentId,
        versionId: drawing.wvmId,
        sourceWvm: drawing.wvm,
        drawingElementId: drawing.drawingElementId,
        // Not `<partNumber>-<revision>`: the Releases tab reads that name as a
        // released drawing.
        assetBaseName: drawingAssetBaseName(
          drawing.partNumber,
          drawing.drawingElementId
        )
      }
    });
  }
  return { models, drawings, unchangedModels, unchangedDrawings };
}

/**
 * One picked file's export. Two run at a time per company, across every
 * push, and one per item: a large push cannot crowd out another company's
 * exports, and two pushes of one company share its two.
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
    if (event.data.kind === "model") {
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

    const states: SourceStates = await step.run("source-states", async () => {
      const documents = sourceStateReads(payload);
      if (documents.length === 0) return { documents: {} };
      const read = await readSourceStates(
        await onshapeClient(carbon, payload),
        documents,
        readOrWarn
      );
      return { documents: read.documents };
    });
    const current: { models: string[]; drawings: string[] } = await step.run(
      "current-files",
      async () =>
        currentFiles(
          payload.companyId,
          payload,
          states,
          await loadFileRecords(
            carbon,
            getJobDatabaseClient(),
            payload.companyId,
            payload
          )
        )
    );
    const work = buildAssetWork(payload, states, current);

    type Task =
      | {
          kind: "model";
          id: string;
          label: string;
          data: SyncOnshapeElementInput;
        }
      | {
          kind: "drawing";
          id: string;
          label: string;
          data: SyncOnshapeDrawingInput;
          sourceKey: string | null;
        };
    const tasks: Task[] = [
      ...work.models.map((model, index) => ({
        kind: "model" as const,
        id: `model-${index}`,
        ...model
      })),
      ...work.drawings.map((drawing, index) => ({
        kind: "drawing" as const,
        id: `drawing-${index}`,
        ...drawing
      }))
    ];

    const totals = {
      models: {
        exported: 0,
        unchanged: work.unchangedModels,
        tooLarge: 0,
        failed: 0
      },
      drawings: {
        exported: 0,
        unchanged: work.unchangedDrawings,
        tooLarge: 0,
        failed: 0
      }
    };
    // A failure streak means something systemic (auth, sustained rate
    // limiting, an outage): stop instead of spending quota on the rest.
    let consecutiveFailures = 0;

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
                    companyId: payload.companyId,
                    itemId: task.data.itemId,
                    model: task.data
                  }
                : {
                    kind: "drawing" as const,
                    companyId: payload.companyId,
                    itemId: task.data.itemId,
                    drawing: task.data
                  }
          })
        )
      );
      for (const [index, result] of results.entries()) {
        const task = batch[index]!;
        const counts = task.kind === "model" ? totals.models : totals.drawings;
        if (result.status === "rejected") {
          console.error(
            `onshape-panel-assets: ${task.label} failed`,
            result.reason
          );
          counts.failed++;
          consecutiveFailures++;
          continue;
        }
        consecutiveFailures = 0;
        if (result.value.tooLarge) {
          counts.tooLarge++;
        } else {
          counts.exported++;
        }
        // A PDF past the limit stays past it until the drawing changes, so it
        // is recorded too.
        if (task.kind === "drawing" && task.sourceKey) {
          const sourceKey = task.sourceKey;
          await step.run(`record-${task.id}`, async () => {
            try {
              await recordDrawingSource(getJobDatabaseClient(), {
                companyId: payload.companyId,
                userId: payload.userId,
                itemId: task.data.itemId,
                drawingElementId: task.data.drawingElementId,
                sourceKey
              });
            } catch (error) {
              // Only an optimization: the next push exports it again.
              console.warn(
                `onshape-panel-assets: could not record ${task.label}`,
                error
              );
            }
          });
        }
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // A retry replays the same memoized failures: end the run now.
        throw new NonRetriableError(
          `onshape-panel-assets: stopping after ${consecutiveFailures} consecutive failures`
        );
      }
    }

    return totals;
  }
);
