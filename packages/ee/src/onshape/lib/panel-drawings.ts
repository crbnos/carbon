// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getLogger } from "@carbon/logger";
import type { OnshapeBomNode } from "../panel/bom";
import type {
  DrawingAssemblyElement,
  DrawingDocument,
  DrawingTie,
  OnshapeDrawing,
  SkippedDrawing
} from "../panel/drawings";
import {
  bomAssemblySources,
  parseDrawingReferences,
  tieDrawings
} from "../panel/drawings";
import type { AssemblyPlan } from "../panel/plan";
import {
  assemblyDrawingDocuments,
  assemblyDrawingTargets
} from "../panel/plan";
import type { OnshapeClient } from "./client";
import { OnshapeWVMType } from "./document.type";
import {
  cacheReferences,
  type DrawingCacheKey,
  drawingState,
  getCachedReferences
} from "./drawing-references-cache";
import { readDocumentDrawings } from "./drawings";
import { settleBefore } from "./source-state";

// The drawings an assembly review offers. A failed read is a warning, never a
// failed review. No read starts after `deadline`; the cache keeps what was
// read, so the next review reads the rest.

const logger = getLogger("ee", "onshape", "drawings");

// Onshape reads in flight at once: enough to keep a large review inside the
// panel's 60 s wait without a burst that trips Onshape's rate limit.
const DRAWING_READS_AT_ONCE = 4;

type DrawingClient = Pick<
  OnshapeClient,
  "getElementsIn" | "resolveAppElementReferences"
>;

/**
 * Runs `run` over `list`, a few at a time; none starts after `deadline`, and
 * one still running then is dropped and counted in `late`.
 */
async function eachUntil<T, R>(
  list: T[],
  deadline: number,
  run: (entry: T) => Promise<R>
): Promise<{ done: R[]; late: number }> {
  const done: R[] = [];
  let late = 0;
  for (let start = 0; start < list.length; start += DRAWING_READS_AT_ONCE) {
    if (Date.now() >= deadline) {
      return { done, late: late + list.length - start };
    }
    const settled = await Promise.all(
      list
        .slice(start, start + DRAWING_READS_AT_ONCE)
        .map((entry) => settleBefore(run(entry), deadline))
    );
    for (const result of settled) {
      if (result.settled) done.push(result.value);
      else late++;
    }
  }
  return { done, late };
}

function onshapeDocument(document: DrawingDocument) {
  return {
    documentId: document.documentId,
    wvm:
      document.wvm === "w" ? OnshapeWVMType.WORKSPACE : OnshapeWVMType.VERSION,
    wvmId: document.wvmId
  };
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export async function readAssemblyDrawings({
  client,
  companyId,
  plan,
  nodes,
  deadline = Number.POSITIVE_INFINITY
}: {
  client: DrawingClient;
  companyId: string;
  plan: AssemblyPlan;
  /** parseBomTree().lines: the whole tree, whatever the plan's depth. */
  nodes: OnshapeBomNode[];
  /** Epoch ms after which no new Onshape read starts. */
  deadline?: number;
}): Promise<{
  tied: { ties: DrawingTie[]; skipped: SkippedDrawing[] };
  warnings: string[];
}> {
  const documents = assemblyDrawingDocuments(plan);
  const warnings: string[] = [];
  const empty = { ties: [], skipped: [] };
  if (documents.length === 0) return { tied: empty, warnings };

  const listed = await eachUntil(documents, deadline, async (document) => {
    try {
      return { document, ...(await readDocumentDrawings(client, document)) };
    } catch (error) {
      logger.warn("Onshape drawing list failed", {
        companyId,
        documentId: document.documentId,
        error
      });
      return null;
    }
  });
  const drawings = listed.done.flatMap((read) => read?.drawings ?? []);
  // Every assembly of the documents read, so a drawing of one outside the
  // push is still an assembly's drawing, as the export job reads it.
  const assemblyElements: DrawingAssemblyElement[] = listed.done.flatMap(
    (read) =>
      read
        ? read.assemblyElementIds.map((elementId) => ({
            ...read.document,
            elementId
          }))
        : []
  );
  const unlistedDocuments = listed.done.filter((read) => read === null).length;
  const lateDocuments = listed.late;
  if (unlistedDocuments > 0) {
    warnings.push(
      `Onshape didn't list the drawings of ${plural(unlistedDocuments, "source document")}, so their rows offer none.`
    );
  }
  if (lateDocuments > 0) {
    warnings.push(
      `The drawings of ${plural(lateDocuments, "source document")} weren't read in time. Open the review again to read them.`
    );
  }
  if (drawings.length === 0) return { tied: empty, warnings };

  const cacheKey = (drawing: OnshapeDrawing): DrawingCacheKey => ({
    companyId,
    documentId: drawing.documentId,
    elementId: drawing.elementId,
    state: drawingState(drawing)
  });
  const read: OnshapeDrawing[] = [];
  // Cached drawings first: they cost no Onshape call, so the deadline only
  // cuts new or changed ones. One parallel read: a failed lookup is a miss.
  const pending: OnshapeDrawing[] = [];
  const cachedAll = await Promise.all(
    drawings.map((drawing) => getCachedReferences(cacheKey(drawing)))
  );
  drawings.forEach((drawing, index) => {
    const cached = cachedAll[index];
    if (cached) read.push({ ...drawing, references: cached.references });
    else pending.push(drawing);
  });
  // A read that finishes late still fills the cache for the next review.
  const resolved = await eachUntil(
    pending,
    deadline,
    async (drawing): Promise<OnshapeDrawing | null> => {
      try {
        const raw = await client.resolveAppElementReferences(
          onshapeDocument(drawing),
          drawing.elementId
        );
        const references = parseDrawingReferences(raw);
        await cacheReferences(cacheKey(drawing), { references });
        return { ...drawing, references };
      } catch (error) {
        logger.warn("Onshape drawing references failed", {
          companyId,
          documentId: drawing.documentId,
          elementId: drawing.elementId,
          error
        });
        return null;
      }
    }
  );
  for (const drawing of resolved.done) if (drawing) read.push(drawing);
  const unread = resolved.done.filter((drawing) => drawing === null).length;
  const lateDrawings = resolved.late;
  if (unread > 0) {
    warnings.push(
      `Onshape didn't say what ${plural(unread, "drawing")} ${unread === 1 ? "shows" : "show"}, so ${unread === 1 ? "it isn't" : "they aren't"} offered.`
    );
  }
  if (lateDrawings > 0) {
    warnings.push(
      `${plural(lateDrawings, "drawing")} ${lateDrawings === 1 ? "wasn't" : "weren't"} read in time. Open the review again to read the rest.`
    );
  }
  // Element list order, so the review lists a row's drawings as Onshape does.
  const drawingKey = (drawing: OnshapeDrawing) =>
    `${drawing.documentId}:${drawing.wvmId}:${drawing.elementId}`;
  const order = new Map(
    drawings.map((drawing, index) => [drawingKey(drawing), index])
  );
  read.sort(
    (a, b) => (order.get(drawingKey(a)) ?? 0) - (order.get(drawingKey(b)) ?? 0)
  );

  const { ties, skipped } = tieDrawings(
    read,
    assemblyDrawingTargets(plan, nodes),
    bomAssemblySources(nodes),
    assemblyElements
  );
  // A document at two states lists a drawing twice: once tied, it is not
  // also skipped, and a drawing skipped twice is listed once.
  const tiedIds = new Set(ties.map((tie) => tie.drawing.elementId));
  const skippedOnce = new Map<string, SkippedDrawing>();
  for (const drawing of skipped) {
    if (!tiedIds.has(drawing.elementId)) {
      skippedOnce.set(drawing.elementId, {
        elementId: drawing.elementId,
        name: drawing.name
      });
    }
  }
  return { tied: { ties, skipped: [...skippedOnce.values()] }, warnings };
}
