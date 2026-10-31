// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { normalizeConfiguration } from "./status";

/** What a drawing shows: an element, and a part of it when Onshape says. */
export type DrawingReference = {
  documentId?: string;
  elementId: string;
  partId?: string;
  /** Absent: Onshape did not say, so any configuration matches. */
  configuration?: string | null;
};

/** A drawing element in one of the push's source documents. */
export type OnshapeDrawing = {
  documentId: string;
  wvm: "w" | "v";
  wvmId: string;
  elementId: string;
  name: string;
  /** The drawing's own microversion; null when the element list omits it. */
  microversionId: string | null;
  references: DrawingReference[];
};

/** A row a drawing can attach to: the root, a sub-assembly or a part. */
export type DrawingTarget = {
  partNumber: string;
  kind: "partstudio" | "assembly";
  documentId: string;
  wvm: "w" | "v";
  wvmId: string;
  elementId: string;
  partId?: string;
  /** Normalized: null is the default configuration. */
  configuration: string | null;
};

export type DrawingTie = { partNumber: string; drawing: OnshapeDrawing };

export type SkippedDrawingReason = "several-parts" | "not-in-push";

export type SkippedDrawing = {
  elementId: string;
  name: string;
  reason: SkippedDrawingReason;
};

/** A Part Studio whose parts a tie needs: a drawing shows all of it. */
export type ElementPartsRequest = {
  documentId: string;
  wvm: "w" | "v";
  wvmId: string;
  elementId: string;
  configuration: string | null;
};

const MAX_REFERENCE_DEPTH = 6;
const SEP = "\u001f";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * The references in a `resolvereferences` answer: every object that names a
 * `targetElementId`, at any depth. Onshape names a part by `idTag`, the BOM's
 * `itemSource.partId`; a reference without one shows the whole element. An
 * empty list reads as a drawing with no model.
 */
export function parseDrawingReferences(raw: unknown): DrawingReference[] {
  const out: DrawingReference[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > MAX_REFERENCE_DEPTH || value === null) return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const elementId = text(record.targetElementId);
    if (elementId) {
      const documentId = text(record.targetDocumentId);
      const partId = text(record.idTag) ?? text(record.partId);
      const hasConfiguration =
        "configuration" in record || "targetConfiguration" in record;
      const configuration = hasConfiguration
        ? normalizeConfiguration(
            text(record.configuration) ?? text(record.targetConfiguration)
          )
        : undefined;
      const key = referenceKey({
        documentId,
        elementId,
        partId,
        configuration
      });
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          elementId,
          ...(documentId ? { documentId } : {}),
          ...(partId ? { partId } : {}),
          ...(configuration !== undefined ? { configuration } : {})
        });
      }
    }
    for (const nested of Object.values(record)) {
      if (nested !== null && typeof nested === "object") {
        walk(nested, depth + 1);
      }
    }
  };
  walk(raw, 0);
  return out;
}

function referenceKey(reference: DrawingReference): string {
  return [
    reference.documentId ?? "",
    reference.elementId,
    reference.partId ?? "",
    reference.configuration === undefined
      ? "*"
      : (reference.configuration ?? "")
  ].join(SEP);
}

/** Keys the parts of one Part Studio at one state and configuration. */
export function elementPartsKey(source: ElementPartsRequest): string {
  return [
    source.documentId,
    source.wvm,
    source.wvmId,
    source.elementId,
    source.configuration ?? ""
  ].join(SEP);
}

/**
 * Whether a reference shows the target. A reference into the drawing's own
 * document shows it at the drawing's version or workspace, so a document the
 * push uses at two states ties each copy of a drawing to its own rows.
 */
function referenceHits(
  reference: DrawingReference,
  target: DrawingTarget,
  drawing: OnshapeDrawing
): boolean {
  if (reference.elementId !== target.elementId) return false;
  const documentId = reference.documentId ?? drawing.documentId;
  if (documentId !== target.documentId) return false;
  if (
    documentId === drawing.documentId &&
    (target.wvm !== drawing.wvm || target.wvmId !== drawing.wvmId)
  ) {
    return false;
  }
  if (
    reference.configuration !== undefined &&
    normalizeConfiguration(reference.configuration) !== target.configuration
  ) {
    return false;
  }
  return true;
}

/**
 * Ties each drawing to at most one row of the push, on what the drawing shows:
 *
 * 1. An assembly in the push it references wins; the first such reference
 *    decides.
 * 2. Else a drawing that shows one part ties to that part's row.
 * 3. Else a drawing that shows a whole Part Studio ties to its row when the
 *    Part Studio has one part. Its parts come from `elementParts`; a Part
 *    Studio not read yet is listed in `needsParts`.
 * 4. Else it is skipped: `several-parts` when it shows more than one part,
 *    `not-in-push` when what it shows has no row.
 *
 * `targets` holds every BOM row, not only the rows that take files, so a
 * drawing is never tied to a row by elimination.
 */
export function tieDrawings(
  drawings: OnshapeDrawing[],
  targets: DrawingTarget[],
  elementParts: ReadonlyMap<string, string[]> = new Map()
): {
  ties: DrawingTie[];
  skipped: SkippedDrawing[];
  needsParts: ElementPartsRequest[];
} {
  const assemblies = targets.filter((target) => target.kind === "assembly");
  const parts = targets.filter((target) => target.kind === "partstudio");
  const ties: DrawingTie[] = [];
  const skipped: SkippedDrawing[] = [];
  const needsParts = new Map<string, ElementPartsRequest>();
  const tie = (partNumber: string, drawing: OnshapeDrawing) => {
    if (
      !ties.some(
        (entry) =>
          entry.partNumber === partNumber &&
          entry.drawing.elementId === drawing.elementId
      )
    ) {
      ties.push({ partNumber, drawing });
    }
  };
  const skip = (drawing: OnshapeDrawing, reason: SkippedDrawingReason) =>
    skipped.push({ elementId: drawing.elementId, name: drawing.name, reason });

  for (const drawing of drawings) {
    let assembly: DrawingTarget | undefined;
    for (const reference of drawing.references) {
      assembly = assemblies.find((target) =>
        referenceHits(reference, target, drawing)
      );
      if (assembly) break;
    }
    if (assembly) {
      tie(assembly.partNumber, drawing);
      continue;
    }

    const shown = new Map<string, DrawingReference>();
    for (const reference of drawing.references) {
      const key = referenceKey({
        ...reference,
        documentId: reference.documentId ?? drawing.documentId
      });
      if (!shown.has(key)) shown.set(key, reference);
    }
    if (shown.size !== 1) {
      skip(drawing, shown.size === 0 ? "not-in-push" : "several-parts");
      continue;
    }
    const reference = [...shown.values()][0]!;

    if (reference.partId) {
      const target = parts.find(
        (candidate) =>
          candidate.partId === reference.partId &&
          referenceHits(reference, candidate, drawing)
      );
      if (target) tie(target.partNumber, drawing);
      else skip(drawing, "not-in-push");
      continue;
    }

    // The whole Part Studio: one part, or several.
    const inElement = parts.filter((candidate) =>
      referenceHits(reference, candidate, drawing)
    );
    if (inElement.length === 0) {
      skip(drawing, "not-in-push");
      continue;
    }
    const first = inElement[0]!;
    if (
      inElement.some(
        (candidate) =>
          candidate.configuration !== first.configuration ||
          candidate.wvmId !== first.wvmId
      )
    ) {
      skip(drawing, "several-parts");
      continue;
    }
    const request: ElementPartsRequest = {
      documentId: first.documentId,
      wvm: first.wvm,
      wvmId: first.wvmId,
      elementId: first.elementId,
      configuration: first.configuration
    };
    const partIds = elementParts.get(elementPartsKey(request));
    if (!partIds) {
      needsParts.set(elementPartsKey(request), request);
      skip(drawing, "several-parts");
      continue;
    }
    const only = partIds.length === 1 ? partIds[0] : undefined;
    const target = only
      ? inElement.find((candidate) => candidate.partId === only)
      : undefined;
    if (target) tie(target.partNumber, drawing);
    else skip(drawing, only ? "not-in-push" : "several-parts");
  }

  // A document at two states lists a drawing twice: once tied, it is not
  // also skipped, and a drawing skipped twice is listed once.
  const tied = new Set(ties.map((entry) => entry.drawing.elementId));
  const listed = new Set<string>();
  const skippedOnce = skipped.filter((entry) => {
    if (tied.has(entry.elementId) || listed.has(entry.elementId)) return false;
    listed.add(entry.elementId);
    return true;
  });

  return { ties, skipped: skippedOnce, needsParts: [...needsParts.values()] };
}

export function skippedDrawingText(drawing: SkippedDrawing): string {
  switch (drawing.reason) {
    case "several-parts":
      return `${drawing.name}: shows several parts, so it isn't attached to any of them`;
    case "not-in-push":
      return `${drawing.name}: shows nothing in this push`;
  }
}
