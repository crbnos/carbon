// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { getLogger } from "@carbon/logger";
import type { OnshapeBomNode } from "../panel/bom";
import type {
  DrawingTie,
  ElementPartsRequest,
  OnshapeDrawing,
  SkippedDrawing
} from "../panel/drawings";
import {
  elementPartsKey,
  parseDrawingReferences,
  tieDrawings
} from "../panel/drawings";
import type { AssemblyPlan, DrawingDocument } from "../panel/plan";
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
import { ONSHAPE_DRAWING_DATA_TYPE, OnshapeElementType } from "./element.type";
import { settleBefore } from "./source-state";

// The drawings an assembly review offers: listed per source document, their
// references resolved (or read from the cache), then tied to rows. Every
// failed read is a warning; none fails the review. Reads stop at `deadline`,
// so a large review answers inside the panel's wait; the cache keeps what was
// read, and the next review reads the rest.

const logger = getLogger("ee", "onshape", "drawings");

// Onshape reads in flight at once: enough to keep a large review inside the
// panel's 60 s wait without a burst that trips Onshape's rate limit.
const DRAWING_READS_AT_ONCE = 4;

type DrawingClient = Pick<
  OnshapeClient,
  "getElementsIn" | "resolveAppElementReferences" | "getPartsInElement"
>;

/**
 * Runs `run` over `list`, a few at a time. None starts after `deadline`, and
 * one still running then is abandoned and its result dropped. Returns the
 * finished runs' results, in list order, and how many did not finish.
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

  const listed = await eachUntil(
    documents,
    deadline,
    async (document): Promise<OnshapeDrawing[] | null> => {
      try {
        const rows = await client.getElementsIn(
          onshapeDocument(document),
          OnshapeElementType.APPLICATION
        );
        return rows
          .filter((row) => row.dataType === ONSHAPE_DRAWING_DATA_TYPE)
          .map((row) => ({
            documentId: document.documentId,
            wvm: document.wvm,
            wvmId: document.wvmId,
            elementId: row.id,
            name: row.name,
            microversionId:
              typeof row.microversionId === "string"
                ? row.microversionId
                : null,
            references: []
          }));
      } catch (error) {
        logger.warn("Onshape drawing list failed", {
          companyId,
          documentId: document.documentId,
          error
        });
        return null;
      }
    }
  );
  const drawings = listed.done.flatMap((rows) => rows ?? []);
  const unlistedDocuments = listed.done.filter((rows) => rows === null).length;
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
  // cuts new or changed ones.
  const pending: OnshapeDrawing[] = [];
  for (const drawing of drawings) {
    const cached = await getCachedReferences(cacheKey(drawing));
    if (cached) {
      read.push({ ...drawing, references: cached.references });
    } else {
      pending.push(drawing);
    }
  }
  // A read that finishes after the deadline still fills the cache, so the
  // next review has it.
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

  const targets = assemblyDrawingTargets(plan, nodes);
  const first = tieDrawings(read, targets);
  if (first.needsParts.length === 0) {
    return { tied: first, warnings };
  }

  // A drawing of a whole Part Studio: it ties only when the Part Studio has
  // one part.
  // A Part Studio left unread keeps its drawings skipped as several parts.
  const partReads = await eachUntil(
    first.needsParts,
    deadline,
    async (request: ElementPartsRequest) => {
      try {
        const parts = await client.getPartsInElement(
          onshapeDocument(request),
          request.elementId,
          request.configuration
        );
        return [
          elementPartsKey(request),
          parts.map((part) => part.partId)
        ] as const;
      } catch (error) {
        logger.warn("Onshape Part Studio parts read failed", {
          companyId,
          elementId: request.elementId,
          error
        });
        return null;
      }
    }
  );
  const elementParts = new Map<string, string[]>(
    partReads.done.flatMap((entry) => (entry ? [[entry[0], entry[1]]] : []))
  );
  const second = tieDrawings(read, targets, elementParts);
  return { tied: second, warnings };
}
