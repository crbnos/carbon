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
import {
  assignDrawingFileNames,
  type DrawingFileClaim
} from "./onshape-drawing-names";
import {
  type DrawingFileRecord,
  drawingSourceKey,
  loadDrawingSources
} from "./onshape-drawing-source";
import {
  assemblySourceKeyAt,
  isOnshapeModelId,
  MODEL_SOURCE_ENTITY_TYPE,
  partSourceId,
  reusableModelUploadId
} from "./onshape-source-keys";

// Which of an assembly push's files an item already has from its source's
// current state; the review and the export job share these reads and keys.

type CarbonClient = SupabaseClient<Database>;
type AssetsPayload = Events["carbon/onshape-panel-assets"]["data"];
export type ModelRow = AssetsPayload["models"][number];
/** A model row before its link exists, as the current-file checks read it. */
export type ModelSourceRow = Omit<ModelRow, "externalId">;
export type DrawingTargetRow = NonNullable<
  AssetsPayload["drawings"]
>["targets"][number];

/** A drawing the push found, with the rows it ties to. */
export type TiedDrawing = {
  documentId: string;
  wvm: "w" | "v";
  wvmId: string;
  drawingElementId: string;
  name: string;
  /** The drawing's own microversion; null when Onshape did not report it. */
  microversionId: string | null;
  targets: DrawingTargetRow[];
};

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

/**
 * The workspaces `readSourceStates` reads for these rows' sources, one
 * element list each, whatever the row: a part, a configured part or an
 * assembly, a model to export or a row that takes drawings.
 */
export function sourceStateReads(
  sources: Array<Pick<ModelRow, "documentId" | "wvm" | "wvmId">>
): WorkspaceDocument[] {
  const documents = new Map<string, WorkspaceDocument>();
  for (const source of sources) {
    if (source.wvm !== "w") continue;
    const document = { documentId: source.documentId, wvmId: source.wvmId };
    documents.set(documentStateKey(document), document);
  }
  return [...documents.values()];
}

/** One Onshape read; null when it failed. The caller decides what a failure costs. */
export type StateRead = <T>(
  label: string,
  read: () => Promise<T>
) => Promise<T | null>;

/**
 * Each workspace's state, `atOnce` at a time. A failed or late read leaves it
 * out and counts in `unread`; none starts after `deadline`.
 */
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
  model: ModelSourceRow,
  states: SourceStates
): string | undefined {
  return model.wvm === "w" && model.kind === "partstudio" && model.partId
    ? states.documents[documentStateKey(model)]?.parts
    : undefined;
}

/** What a part model's item link records about the source it was made from. */
export type SourceStateStamp = {
  itemId: string;
  /** The link's own key: a link since moved to another source is left alone. */
  externalId: string;
  patch: { microversionId: string | null; modelVersionId: string | null };
};

/**
 * What to record on the links of the part models the item now holds from its
 * source (`settledItemIds`: current or just exported), so a part push of the
 * same source reads them as unchanged. A workspace records its parts state,
 * which the part plan compares (`microversionId`); a version records its id
 * (`modelVersionId`). Each clears the other, so a model from one does not
 * read as current for the other. A workspace whose state was not read, and
 * any assembly (a part push never plans one), get no stamp.
 */
export function sourceStateStamps(
  models: ModelRow[],
  states: SourceStates,
  settledItemIds: ReadonlySet<string>
): SourceStateStamp[] {
  const stamps = new Map<string, SourceStateStamp>();
  for (const model of models) {
    if (
      model.kind !== "partstudio" ||
      !model.partId ||
      !settledItemIds.has(model.itemId)
    ) {
      continue;
    }
    const microversionId = modelSourceMicroversion(model, states) ?? null;
    if (model.wvm === "w" && !microversionId) continue;
    stamps.set(model.itemId, {
      itemId: model.itemId,
      externalId: model.externalId,
      patch: {
        microversionId,
        modelVersionId: model.wvm === "v" ? model.wvmId : null
      }
    });
  }
  return [...stamps.values()];
}

/** What Carbon holds for the models' items. */
export type ModelRecords = {
  /** The item's current model, by item id. */
  modelUploadIds: Record<string, string | null>;
  /** The source of an assembly item's last export, by item id. */
  modelSources: Record<
    string,
    { externalId: string | null; metadata: unknown }
  >;
};

export async function loadModelRecords(
  carbon: CarbonClient,
  companyId: string,
  models: ModelSourceRow[]
): Promise<ModelRecords> {
  const unique = (ids: string[]) => [...new Set(ids)];
  const modelItemIds = unique(models.map((model) => model.itemId));
  const assemblyItemIds = unique(
    models
      .filter((model) => model.kind === "assembly")
      .map((model) => model.itemId)
  );
  const [items, sources] = await Promise.all([
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
        )
  ]);
  if (items.error || sources.error) {
    throw new Error(
      `model record lookup failed: ${(items.error ?? sources.error)!.message}`
    );
  }
  return {
    modelUploadIds: Object.fromEntries(
      items.data.map((item) => [item.id, item.modelUploadId ?? null])
    ),
    modelSources: Object.fromEntries(
      sources.data.map((row) => [
        row.entityId,
        { externalId: row.externalId, metadata: row.metadata }
      ])
    )
  };
}

/**
 * The items, by id, that already have their row's model from the source's
 * current state. A state Onshape did not report reads as changed.
 */
export function currentModels(
  companyId: string,
  models: ModelSourceRow[],
  states: SourceStates,
  records: ModelRecords
): string[] {
  const current = models.filter((model) => {
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
  return [...new Set(current.map((model) => model.itemId))];
}

/** The state a row's source is at: its version, else its workspace's source state. */
export function targetState(
  target: Pick<DrawingTargetRow, "kind" | "documentId" | "wvm" | "wvmId">,
  states: SourceStates
): string | null {
  if (target.wvm === "v") return `v:${target.wvmId}`;
  const workspace = states.documents[documentStateKey(target)];
  return (
    (target.kind === "assembly" ? workspace?.assemblies : workspace?.parts) ??
    null
  );
}

/** What a drawing's PDF on a row is recorded under; null when a state is unknown. */
export function drawingTargetSourceKey(
  drawing: TiedDrawing,
  target: DrawingTargetRow,
  states: SourceStates
): string | null {
  return drawingSourceKey({
    drawingElementId: drawing.drawingElementId,
    drawingState:
      drawing.wvm === "v" ? `v:${drawing.wvmId}` : drawing.microversionId,
    targetState: targetState(target, states)
  });
}

/** What Carbon holds of the found drawings' rows: their records and their files. */
export type DrawingRecords = {
  /** Per item id, what it holds of each drawing, by drawing element id. */
  records: Record<string, Record<string, DrawingFileRecord>>;
  /** Per item id, the names of the files on the item. */
  files: Record<string, string[]>;
};

export async function loadDrawingRecords(
  carbon: CarbonClient,
  db: Kysely<KyselyDatabase>,
  companyId: string,
  drawings: TiedDrawing[]
): Promise<DrawingRecords> {
  const itemIds = [
    ...new Set(
      drawings.flatMap((drawing) => drawing.targets.map((t) => t.itemId))
    )
  ];
  const records = await loadDrawingSources(carbon, companyId, itemIds);
  if (itemIds.length === 0) return { records, files: {} };
  // Storage, not document rows: the item's Files card lists and deletes the
  // objects. Every file directly in each item's folder (`itemDocumentPath`).
  const prefix = `${companyId.replace(/[\\%_]/g, "\\$&")}/parts/%`;
  const rows = (
    await sql<{ itemId: string; fileName: string }>`
      SELECT split_part(name, '/', 3) AS "itemId",
             split_part(name, '/', 4) AS "fileName"
      FROM storage.objects
      WHERE bucket_id = ${getCompanyPrivateBucket(companyId)}
        AND name LIKE ${prefix}
        AND split_part(name, '/', 3) = ANY(${itemIds}::text[])
        AND split_part(name, '/', 4) <> ''
        AND split_part(name, '/', 5) = ''
    `.execute(db)
  ).rows;
  const files: Record<string, string[]> = {};
  for (const row of rows) {
    (files[row.itemId] ??= []).push(row.fileName);
  }
  return { records, files };
}

/** A drawing's PDF that is renamed, or whose file name is recorded, before any export. */
export type DrawingPlacement = {
  itemId: string;
  drawingElementId: string;
  /** The drawing's PDF on the item under its old name, moved to `record.fileName`. */
  from: string | null;
  /** What the item's record of the drawing holds until an export replaces it. */
  record: DrawingFileRecord;
};

export type DrawingExport = {
  drawing: TiedDrawing;
  /** The rows that lack its current PDF, each with what to record it under. */
  targets: Array<
    DrawingTargetRow & { sourceKey: string | null; fileName: string }
  >;
};

function heldDrawing(
  drawing: TiedDrawing,
  target: DrawingTargetRow,
  held: DrawingRecords
) {
  const record = held.records[target.itemId]?.[drawing.drawingElementId];
  const stored =
    record !== undefined &&
    (held.files[target.itemId] ?? []).includes(record.fileName);
  return { record, stored };
}

function isCurrentDrawing(
  sourceKey: string | null,
  { record, stored }: ReturnType<typeof heldDrawing>
): boolean {
  return (
    sourceKey !== null &&
    record?.sourceKey === sourceKey &&
    (record.tooLarge === true || stored)
  );
}

export type DrawingPlan = {
  exports: DrawingExport[];
  placements: DrawingPlacement[];
  /** Rows that hold the drawing's current PDF under its current name. */
  unchanged: number;
  /** Rows that hold the current PDF under a name the drawing no longer has. */
  renamed: number;
};

/**
 * What each found drawing needs on each row it shows. Its PDF is named after
 * the drawing (`assignDrawingFileNames`). A row holds the current PDF when its
 * record has the same source key and the file is still stored (or the PDF was
 * too large); otherwise it is exported. A file stored under another name than
 * the one assigned is moved first, so a renamed drawing leaves no stale copy.
 * A new name is recorded before the export, so a concurrent push sees it taken.
 */
export function planDrawingFiles(
  drawings: TiedDrawing[],
  states: SourceStates,
  held: DrawingRecords
): DrawingPlan {
  const claimsByItem = new Map<
    string,
    { partNumber: string; claims: DrawingFileClaim[] }
  >();
  for (const drawing of drawings) {
    for (const target of drawing.targets) {
      const entry = claimsByItem.get(target.itemId) ?? {
        partNumber: target.partNumber,
        claims: []
      };
      entry.claims.push({
        drawingElementId: drawing.drawingElementId,
        name: drawing.name,
        recorded:
          held.records[target.itemId]?.[drawing.drawingElementId]?.fileName ??
          null
      });
      claimsByItem.set(target.itemId, entry);
    }
  }
  const names = new Map<string, Record<string, string>>();
  for (const [itemId, { partNumber, claims }] of claimsByItem) {
    const claimed = new Set(claims.map((claim) => claim.drawingElementId));
    names.set(
      itemId,
      assignDrawingFileNames({
        partNumber,
        files: held.files[itemId] ?? [],
        reserved: Object.entries(held.records[itemId] ?? {})
          .filter(([drawingElementId]) => !claimed.has(drawingElementId))
          .map(([, record]) => record.fileName),
        claims
      })
    );
  }

  const plan: DrawingPlan = {
    exports: [],
    placements: [],
    unchanged: 0,
    renamed: 0
  };
  for (const drawing of drawings) {
    const targets: DrawingExport["targets"] = [];
    for (const target of drawing.targets) {
      const fileName = names.get(target.itemId)?.[drawing.drawingElementId];
      if (!fileName) continue;
      const holding = heldDrawing(drawing, target, held);
      const { record, stored } = holding;
      const sourceKey = drawingTargetSourceKey(drawing, target, states);
      const current = isCurrentDrawing(sourceKey, holding);
      const from =
        record && stored && record.fileName !== fileName
          ? record.fileName
          : null;
      if (record?.fileName !== fileName) {
        plan.placements.push({
          itemId: target.itemId,
          drawingElementId: drawing.drawingElementId,
          from,
          record: {
            sourceKey: record?.sourceKey ?? null,
            fileName,
            ...(record?.tooLarge ? { tooLarge: true as const } : {})
          }
        });
      }
      if (!current) targets.push({ ...target, sourceKey, fileName });
      else if (from) plan.renamed++;
      else plan.unchanged++;
    }
    if (targets.length > 0) plan.exports.push({ drawing, targets });
  }
  return plan;
}

/** Keys a drawing on its item, as `CurrentFilesCheck` returns it. */
export function drawingFileKey(row: {
  itemId: string;
  drawingElementId: string;
}): string {
  return [row.itemId, row.drawingElementId].join(SEP);
}

/** The review's rows: each model, and each drawing with its target rows. */
export type FileRows = { models: ModelSourceRow[]; drawings: TiedDrawing[] };

/** What Carbon holds for the review's rows. */
export type FileRecords = { models: ModelRecords; drawings: DrawingRecords };

export type CurrentFiles = { models: string[]; drawings: string[] };

/**
 * The rows whose item could hold the current file: a model, or a recorded
 * drawing stored or too large. Only these need Onshape reads.
 */
export function rowsWithFiles(rows: FileRows, records: FileRecords): FileRows {
  return {
    models: rows.models.filter(
      (model) =>
        !!records.models.modelUploadIds[model.itemId] &&
        (model.kind === "partstudio" ||
          !!records.models.modelSources[model.itemId])
    ),
    drawings: rows.drawings.flatMap((drawing) => {
      const targets = drawing.targets.filter((target) => {
        const { record, stored } = heldDrawing(
          drawing,
          target,
          records.drawings
        );
        return stored || record?.tooLarge === true;
      });
      return targets.length > 0 ? [{ ...drawing, targets }] : [];
    })
  };
}

/** Drawings held from the sources' current states, by `drawingFileKey`. */
export function currentDrawingFiles(
  drawings: TiedDrawing[],
  states: SourceStates,
  held: DrawingRecords
): string[] {
  const keys = drawings.flatMap((drawing) =>
    drawing.targets
      .filter((target) =>
        isCurrentDrawing(
          drawingTargetSourceKey(drawing, target, states),
          heldDrawing(drawing, target, held)
        )
      )
      .map((target) =>
        drawingFileKey({
          itemId: target.itemId,
          drawingElementId: drawing.drawingElementId
        })
      )
  );
  return [...new Set(keys)];
}

/**
 * The rows' files Carbon holds from an Onshape export whose source state is
 * unknown: the workspace was not read, or Onshape reported no state for the
 * drawing. They are neither current nor out of date, and they still export.
 */
export function uncheckedFiles(
  rows: FileRows,
  records: FileRecords,
  states: SourceStates
): CurrentFiles {
  const models = rows.models
    .filter(
      (model) =>
        model.wvm === "w" &&
        isOnshapeModelId(records.models.modelUploadIds[model.itemId]) &&
        !states.documents[documentStateKey(model)]
    )
    .map((model) => model.itemId);
  const drawings = rows.drawings.flatMap((drawing) =>
    drawing.targets
      .filter(
        (target) =>
          heldDrawing(drawing, target, records.drawings).stored &&
          drawingTargetSourceKey(drawing, target, states) === null
      )
      .map((target) =>
        drawingFileKey({
          itemId: target.itemId,
          drawingElementId: drawing.drawingElementId
        })
      )
  );
  return { models: [...new Set(models)], drawings: [...new Set(drawings)] };
}

/**
 * Files from an earlier Onshape export that are not current: models by item
 * id, drawings by `drawingFileKey`. Never a hand-uploaded model (another file,
 * not an old one) or an `unchecked` file.
 */
export function outOfDateFiles(
  rows: FileRows,
  records: FileRecords,
  current: CurrentFiles,
  unchecked: CurrentFiles = { models: [], drawings: [] }
): CurrentFiles {
  const currentModelItems = new Set([...current.models, ...unchecked.models]);
  const currentDrawings = new Set([...current.drawings, ...unchecked.drawings]);
  const models = rows.models
    .map((model) => model.itemId)
    .filter(
      (itemId) =>
        isOnshapeModelId(records.models.modelUploadIds[itemId]) &&
        !currentModelItems.has(itemId)
    );
  const drawings = rows.drawings
    .flatMap((drawing) =>
      drawing.targets
        .filter(
          (target) => heldDrawing(drawing, target, records.drawings).stored
        )
        .map((target) =>
          drawingFileKey({
            itemId: target.itemId,
            drawingElementId: drawing.drawingElementId
          })
        )
    )
    .filter((key) => !currentDrawings.has(key));
  return { models: [...new Set(models)], drawings: [...new Set(drawings)] };
}

export type CurrentFilesCheck = CurrentFiles & {
  /** Files Carbon holds from an earlier export of a changed source. */
  outOfDate: CurrentFiles;
  /** Files Carbon holds whose source state is unknown (`uncheckedFiles`). */
  unchecked: CurrentFiles;
  /** Workspaces whose state was not read: their files are `unchecked`. */
  unread: number;
};

/**
 * For the review: which rows' files are current. Carbon's records come first,
 * so Onshape is read only for rows whose item has a file.
 */
export async function readCurrentFiles(input: {
  client: Pick<OnshapeClient, "getWorkspaceSourceStates">;
  carbon: CarbonClient;
  db: Kysely<KyselyDatabase>;
  companyId: string;
  rows: FileRows;
  read: StateRead;
  deadline?: number;
}): Promise<CurrentFilesCheck> {
  const none: CurrentFiles = { models: [], drawings: [] };
  if (input.rows.models.length === 0 && input.rows.drawings.length === 0) {
    return { ...none, outOfDate: none, unchecked: none, unread: 0 };
  }
  const [models, drawings] = await Promise.all([
    loadModelRecords(input.carbon, input.companyId, input.rows.models),
    loadDrawingRecords(
      input.carbon,
      input.db,
      input.companyId,
      input.rows.drawings
    )
  ]);
  const records: FileRecords = { models, drawings };
  const candidates = rowsWithFiles(input.rows, records);
  if (candidates.models.length === 0 && candidates.drawings.length === 0) {
    return {
      ...none,
      outOfDate: outOfDateFiles(input.rows, records, none),
      unchecked: none,
      unread: 0
    };
  }
  const states = await readSourceStates(
    input.client,
    sourceStateReads([
      ...candidates.models,
      ...candidates.drawings.flatMap((drawing) => drawing.targets)
    ]),
    input.read,
    { atOnce: 4, deadline: input.deadline }
  );
  const current: CurrentFiles = {
    models: currentModels(input.companyId, candidates.models, states, models),
    drawings: currentDrawingFiles(candidates.drawings, states, drawings)
  };
  const unchecked = uncheckedFiles(candidates, records, states);
  return {
    ...current,
    outOfDate: outOfDateFiles(input.rows, records, current, unchecked),
    unchecked,
    unread: states.unread
  };
}
