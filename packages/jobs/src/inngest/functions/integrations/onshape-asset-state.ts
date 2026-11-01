// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { OnshapeClient } from "@carbon/ee/onshape";
import {
  selectInBatches,
  settleBefore,
  type WorkspaceSourceStates
} from "@carbon/ee/onshape";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { getCompanyPrivateBucket } from "@carbon/files";
import type { Events } from "@carbon/lib/events";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { drawingSourceKey, loadDrawingSources } from "./onshape-drawing-source";
import {
  assemblySourceKeyAt,
  isOnshapeModelId,
  itemDocumentPath,
  MODEL_SOURCE_ENTITY_TYPE,
  partSourceId,
  reusableModelUploadId
} from "./onshape-source-keys";

// Which of an assembly push's picked files an item already has from its
// source's current state. The review marks them and the export job skips
// them, with the same reads and the same keys, so the two agree.

type CarbonClient = SupabaseClient<Database>;
type AssetsPayload = Events["carbon/onshape-panel-assets"]["data"];
export type ModelRow = AssetsPayload["models"][number];
export type DrawingRow = AssetsPayload["drawings"][number];
export type AssetRows = { models: ModelRow[]; drawings: DrawingRow[] };
type AssetSource = DrawingRow["target"];

const SEP = "\u001f";

/**
 * What the workspace sources are now, by `documentStateKey`: each workspace's
 * `workspaceSourceStates`, one for its parts and one for its assemblies. A
 * version needs none: its id is its state.
 */
export type SourceStates = {
  documents: Record<string, WorkspaceSourceStates>;
};

type WorkspaceDocument = { documentId: string; wvmId: string };

export function documentStateKey(source: WorkspaceDocument): string {
  return [source.documentId, source.wvmId].join(SEP);
}

/** The PDF name a drawing gets on its item; never `<partNumber>-<revision>`. */
export function drawingAssetBaseName(
  partNumber: string,
  drawingElementId: string
): string {
  return `${partNumber}-${drawingElementId}`;
}

export function drawingPdfPath(
  companyId: string,
  drawing: Pick<DrawingRow, "itemId" | "partNumber" | "drawingElementId">
): string {
  return itemDocumentPath(
    companyId,
    drawing.itemId,
    `${drawingAssetBaseName(drawing.partNumber, drawing.drawingElementId)}.pdf`
  );
}

/** Keys a drawing on its item, as `currentFiles` returns it. */
export function drawingFileKey(
  drawing: Pick<DrawingRow, "itemId" | "drawingElementId">
): string {
  return [drawing.itemId, drawing.drawingElementId].join(SEP);
}

/**
 * The workspaces `readSourceStates` reads for these rows' sources, one element
 * list each, whatever the row: a part, a configured part, an assembly, or a
 * whole Part Studio a drawing shows.
 */
export function sourceStateReads(rows: AssetRows): WorkspaceDocument[] {
  const documents = new Map<string, WorkspaceDocument>();
  const add = (source: AssetSource) => {
    if (source.wvm !== "w") return;
    const document = { documentId: source.documentId, wvmId: source.wvmId };
    documents.set(documentStateKey(document), document);
  };
  for (const model of rows.models) add(model);
  for (const drawing of rows.drawings) add(drawing.target);
  return [...documents.values()];
}

/** One Onshape read; null when it failed. The caller decides what a failure costs. */
export type StateRead = <T>(
  label: string,
  read: () => Promise<T>
) => Promise<T | null>;

export async function readSourceStates(
  client: Pick<OnshapeClient, "getWorkspaceSourceStates">,
  documents: WorkspaceDocument[],
  read: StateRead,
  options: { atOnce?: number; deadline?: number } = {}
): Promise<SourceStates & { unread: number }> {
  const atOnce = options.atOnce ?? 1;
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const states: SourceStates = { documents: {} };
  let unread = 0;
  for (let start = 0; start < documents.length; start += atOnce) {
    if (Date.now() >= deadline) {
      unread += documents.length - start;
      break;
    }
    const batch = documents.slice(start, start + atOnce);
    // A read still running at the deadline is dropped, not waited for.
    const settled = await Promise.all(
      batch.map((document) =>
        settleBefore(
          read(`source state of ${document.documentId}`, () =>
            client.getWorkspaceSourceStates(document.documentId, document.wvmId)
          ),
          deadline
        )
      )
    );
    settled.forEach((result, index) => {
      if (result.settled && result.value) {
        states.documents[documentStateKey(batch[index]!)] = result.value;
      } else {
        unread++;
      }
    });
  }
  return { ...states, unread };
}

/** A workspace part's source state, which names its model as the part push does. */
export function modelSourceMicroversion(
  model: ModelRow,
  states: SourceStates
): string | undefined {
  return model.wvm === "w" && model.kind === "partstudio" && model.partId
    ? states.documents[documentStateKey(model)]?.parts
    : undefined;
}

/** The state a source is at: its version, else what Onshape reported for it. */
export function targetState(
  target: AssetSource,
  states: SourceStates
): string | null {
  if (target.wvm === "v") return `v:${target.wvmId}`;
  const workspace = states.documents[documentStateKey(target)];
  return (
    (target.kind === "assembly" ? workspace?.assemblies : workspace?.parts) ??
    null
  );
}

/** The source key a drawing's export is recorded under; null when a state is unknown. */
export function drawingRowSourceKey(
  drawing: DrawingRow,
  states: SourceStates
): string | null {
  return drawingSourceKey({
    drawingElementId: drawing.drawingElementId,
    drawingState:
      drawing.wvm === "v"
        ? `v:${drawing.wvmId}`
        : (drawing.drawingMicroversionId ?? null),
    targetState: targetState(drawing.target, states)
  });
}

/** What Carbon holds for the rows' items: models, model sources, drawing records, PDFs. */
export type FileRecords = {
  /** The item's current model, by item id. */
  modelUploadIds: Record<string, string | null>;
  /** The source of an assembly item's last export, by item id. */
  modelSources: Record<
    string,
    { externalId: string | null; metadata: unknown }
  >;
  /** Per item id, the source key of each drawing it last got. */
  drawingKeys: Record<string, Record<string, string>>;
  /** The recorded drawings' PDFs still in storage. */
  storedPaths: string[];
};

export async function loadFileRecords(
  carbon: CarbonClient,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  rows: AssetRows
): Promise<FileRecords> {
  const unique = (ids: string[]) => [...new Set(ids)];
  const modelItemIds = unique(rows.models.map((model) => model.itemId));
  const assemblyItemIds = unique(
    rows.models
      .filter((model) => model.kind === "assembly")
      .map((model) => model.itemId)
  );
  const [items, sources, drawingKeys] = await Promise.all([
    modelItemIds.length === 0
      ? { data: [], error: null }
      : selectInBatches(modelItemIds, (batch) =>
          carbon
            .from("item")
            .select("id, modelUploadId")
            .eq("companyId", companyId)
            .in("id", batch)
        ),
    assemblyItemIds.length === 0
      ? { data: [], error: null }
      : selectInBatches(assemblyItemIds, (batch) =>
          carbon
            .from("externalIntegrationMapping")
            .select("id, entityId, externalId, metadata")
            .eq("companyId", companyId)
            .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
            .eq("entityType", MODEL_SOURCE_ENTITY_TYPE)
            .in("entityId", batch)
        ),
    rows.drawings.length === 0
      ? ({} as Record<string, Record<string, string>>)
      : loadDrawingSources(
          carbon,
          companyId,
          rows.drawings.map((drawing) => drawing.itemId)
        )
  ]);
  if (items.error || sources.error) {
    throw new Error(
      `file record lookup failed: ${(items.error ?? sources.error)!.message}`
    );
  }

  // Storage, not a document row: the item's Files tab deletes the object.
  const paths = rows.drawings
    .filter(
      (drawing) => drawingKeys[drawing.itemId]?.[drawing.drawingElementId]
    )
    .map((drawing) => drawingPdfPath(companyId, drawing));
  const stored =
    paths.length === 0
      ? []
      : (
          await sql<{ name: string }>`
            SELECT name FROM storage.objects
            WHERE bucket_id = ${getCompanyPrivateBucket(companyId)}
              AND name = ANY(${paths}::text[])
          `.execute(db)
        ).rows.map((row) => row.name);

  return {
    modelUploadIds: Object.fromEntries(
      items.data.map((item) => [item.id, item.modelUploadId ?? null])
    ),
    modelSources: Object.fromEntries(
      sources.data.map((row) => [
        row.entityId,
        { externalId: row.externalId, metadata: row.metadata }
      ])
    ),
    drawingKeys,
    storedPaths: stored
  };
}

/**
 * The rows whose item could hold the current file: it has a model, or the
 * drawing's PDF is recorded and still stored. Only these need Onshape reads.
 */
export function rowsWithFiles(
  companyId: string,
  rows: AssetRows,
  records: FileRecords
): AssetRows {
  const stored = new Set(records.storedPaths);
  return {
    models: rows.models.filter(
      (model) =>
        !!records.modelUploadIds[model.itemId] &&
        (model.kind === "partstudio" || !!records.modelSources[model.itemId])
    ),
    drawings: rows.drawings.filter(
      (drawing) =>
        !!records.drawingKeys[drawing.itemId]?.[drawing.drawingElementId] &&
        stored.has(drawingPdfPath(companyId, drawing))
    )
  };
}

/**
 * The files the rows' items already have from the sources' current states:
 * models by item id, drawings by `drawingFileKey`. A state Onshape did not
 * report reads as changed.
 */
export function currentFiles(
  companyId: string,
  rows: AssetRows,
  states: SourceStates,
  records: FileRecords
): { models: string[]; drawings: string[] } {
  const stored = new Set(records.storedPaths);
  const models = rows.models.filter((model) => {
    const itemModel = records.modelUploadIds[model.itemId];
    if (!itemModel) return false;
    if (model.kind === "partstudio") {
      const id = partSourceId({
        modelElementKind: "partstudio",
        sourceWvm: model.wvm,
        sourceMicroversionId: modelSourceMicroversion(model, states),
        companyId,
        itemId: model.itemId,
        documentId: model.documentId,
        versionId: model.wvmId,
        modelElementId: model.elementId,
        partId: model.partId,
        configuration: model.configuration ?? undefined
      });
      return id !== null && id === itemModel;
    }
    const state =
      model.wvm === "v"
        ? model.wvmId
        : states.documents[documentStateKey(model)]?.assemblies;
    if (!state) return false;
    const source = assemblySourceKeyAt(
      {
        documentId: model.documentId,
        sourceWvm: model.wvm,
        modelElementId: model.elementId,
        configuration: model.configuration ?? undefined
      },
      state
    );
    return (
      reusableModelUploadId(
        records.modelSources[model.itemId] ?? null,
        itemModel,
        source
      ) !== null
    );
  });
  const drawings = rows.drawings.filter((drawing) => {
    const key = drawingRowSourceKey(drawing, states);
    return (
      key !== null &&
      records.drawingKeys[drawing.itemId]?.[drawing.drawingElementId] === key &&
      stored.has(drawingPdfPath(companyId, drawing))
    );
  });
  return {
    models: [...new Set(models.map((model) => model.itemId))],
    drawings: [...new Set(drawings.map(drawingFileKey))]
  };
}

/**
 * The rows' files that Carbon holds from an earlier Onshape export but are
 * not current: models by item id, drawings by `drawingFileKey`. A model
 * uploaded by hand is not one: it is not out of date, it is another file.
 */
export function outOfDateFiles(
  companyId: string,
  rows: AssetRows,
  records: FileRecords,
  current: { models: string[]; drawings: string[] }
): { models: string[]; drawings: string[] } {
  const currentModels = new Set(current.models);
  const currentDrawings = new Set(current.drawings);
  const models = rows.models
    .map((model) => model.itemId)
    .filter(
      (itemId) =>
        isOnshapeModelId(records.modelUploadIds[itemId]) &&
        !currentModels.has(itemId)
    );
  const drawings = rowsWithFiles(companyId, rows, records)
    .drawings.map(drawingFileKey)
    .filter((key) => !currentDrawings.has(key));
  return { models: [...new Set(models)], drawings: [...new Set(drawings)] };
}

export type CurrentFilesCheck = {
  /** Current files: models by item id, drawings by `drawingFileKey`. */
  models: string[];
  drawings: string[];
  /** Files Carbon holds from an earlier export of a changed source. */
  outOfDate: { models: string[]; drawings: string[] };
  /** Workspaces whose state was not read: their files count as not current. */
  unread: number;
};

/**
 * For the review: which of these rows' files are current. Carbon's records
 * come first, so Onshape is read only for rows whose item has a file, and
 * no read runs past `deadline`.
 */
export async function readCurrentFiles(input: {
  client: Pick<OnshapeClient, "getWorkspaceSourceStates">;
  carbon: CarbonClient;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  rows: AssetRows;
  read: StateRead;
  deadline?: number;
}): Promise<CurrentFilesCheck> {
  const none: CurrentFilesCheck = {
    models: [],
    drawings: [],
    outOfDate: { models: [], drawings: [] },
    unread: 0
  };
  if (input.rows.models.length === 0 && input.rows.drawings.length === 0) {
    return none;
  }
  const records = await loadFileRecords(
    input.carbon,
    input.db,
    input.companyId,
    input.rows
  );
  const candidates = rowsWithFiles(input.companyId, input.rows, records);
  if (candidates.models.length === 0 && candidates.drawings.length === 0) {
    return {
      ...none,
      outOfDate: outOfDateFiles(input.companyId, input.rows, records, none)
    };
  }
  const states = await readSourceStates(
    input.client,
    sourceStateReads(candidates),
    input.read,
    { atOnce: 4, deadline: input.deadline }
  );
  const current = currentFiles(input.companyId, candidates, states, records);
  return {
    ...current,
    outOfDate: outOfDateFiles(input.companyId, input.rows, records, current),
    unread: states.unread
  };
}
