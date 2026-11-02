// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { OnshapeBomNode } from "./bom";
import { normalizeConfiguration } from "./status";

// Which rows of a push a drawing belongs to, read from what the drawing
// shows. A drawing of an assembly belongs to that assembly; any other drawing
// belongs to every part it shows.

/** What a drawing shows: an element, and a part of it when Onshape says. */
export type DrawingReference = {
  documentId?: string;
  /** The version of another document the drawing shows; absent in a workspace. */
  versionId?: string;
  elementId: string;
  partId?: string;
  /** Absent: Onshape did not say, so any configuration matches. */
  configuration?: string | null;
};

/** A workspace or a version of a document. */
export type DrawingDocument = {
  documentId: string;
  wvm: "w" | "v";
  wvmId: string;
};

/** A drawing element in one of the push's source documents. */
export type OnshapeDrawing = DrawingDocument & {
  elementId: string;
  name: string;
  /** The drawing's own microversion; null when the element list omits it. */
  microversionId: string | null;
  references: DrawingReference[];
};

/** A row's Onshape source: one part of a Part Studio, or an assembly. */
export type DrawingSource = DrawingDocument & {
  kind: "partstudio" | "assembly";
  elementId: string;
  partId?: string;
  /** Normalized: null is the default configuration. */
  configuration: string | null;
};

/** A row that takes drawings, under an id the caller chooses. */
export type DrawingTarget = DrawingSource & { id: string };

/** An assembly element of a document state, whether or not the push has it. */
export type DrawingAssemblyElement = DrawingDocument & { elementId: string };

export type DrawingTie = { drawing: OnshapeDrawing; targetIds: string[] };

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
      const versionId = text(record.targetVersionId);
      const partId = text(record.idTag) ?? text(record.partId);
      const hasConfiguration =
        "configuration" in record || "targetConfiguration" in record;
      const configuration = hasConfiguration
        ? normalizeConfiguration(
            text(record.configuration) ?? text(record.targetConfiguration)
          )
        : undefined;
      const key = [
        documentId ?? "",
        versionId ?? "",
        elementId,
        partId ?? "",
        configuration === undefined ? "*" : (configuration ?? "")
      ].join(SEP);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          elementId,
          ...(documentId ? { documentId } : {}),
          ...(versionId ? { versionId } : {}),
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

/**
 * Whether a reference shows an element of a document state. A reference into
 * the drawing's own document shows it at the drawing's version or workspace,
 * so a document the push uses at two states ties each copy of a drawing to its
 * own rows. A reference into another document shows the version it names.
 */
function showsElement(
  reference: DrawingReference,
  element: DrawingAssemblyElement,
  drawing: OnshapeDrawing
): boolean {
  if (reference.elementId !== element.elementId) return false;
  const documentId = reference.documentId ?? drawing.documentId;
  if (documentId !== element.documentId) return false;
  if (documentId === drawing.documentId) {
    return element.wvm === drawing.wvm && element.wvmId === drawing.wvmId;
  }
  return (
    !reference.versionId ||
    (element.wvm === "v" && element.wvmId === reference.versionId)
  );
}

/** Whether a reference shows a row's element, at the row's configuration. */
function referenceHits(
  reference: DrawingReference,
  source: DrawingSource,
  drawing: OnshapeDrawing
): boolean {
  if (!showsElement(reference, source, drawing)) return false;
  return (
    reference.configuration === undefined ||
    normalizeConfiguration(reference.configuration) === source.configuration
  );
}

/**
 * Ties each drawing to the rows it shows:
 *
 * 1. A drawing that shows an assembly is that assembly's: it ties to that
 *    row, and to nothing when the assembly takes no files. The first
 *    reference to an assembly decides. An assembly is known from `assemblies`
 *    (every assembly of the push) or `assemblyElements` (every assembly of
 *    the documents read, in the push or not), so a drawing of one that takes
 *    no files never falls through to the parts it shows.
 * 2. Any other drawing ties to every part row it shows: a part by id, or
 *    every part of a whole Part Studio it shows.
 *
 * A drawing that ties to no row is returned in `skipped`.
 */
export function tieDrawings(
  drawings: OnshapeDrawing[],
  targets: DrawingTarget[],
  assemblies: DrawingSource[] = [],
  assemblyElements: DrawingAssemblyElement[] = []
): { ties: DrawingTie[]; skipped: OnshapeDrawing[] } {
  const assemblyTargets = targets.filter(
    (target) => target.kind === "assembly"
  );
  const partTargets = targets.filter((target) => target.kind === "partstudio");
  const ties: DrawingTie[] = [];
  const skipped: OnshapeDrawing[] = [];

  for (const drawing of drawings) {
    let assembly: { target: DrawingTarget | null } | null = null;
    for (const reference of drawing.references) {
      const target = assemblyTargets.find((candidate) =>
        referenceHits(reference, candidate, drawing)
      );
      if (target) {
        assembly = { target };
        break;
      }
      if (
        assemblies.some(
          (candidate) =>
            candidate.kind === "assembly" &&
            referenceHits(reference, candidate, drawing)
        ) ||
        assemblyElements.some((element) =>
          showsElement(reference, element, drawing)
        )
      ) {
        assembly = { target: null };
        break;
      }
    }
    if (assembly) {
      if (assembly.target) {
        ties.push({ drawing, targetIds: [assembly.target.id] });
      } else {
        skipped.push(drawing);
      }
      continue;
    }

    const targetIds = new Set<string>();
    for (const reference of drawing.references) {
      for (const target of partTargets) {
        if (
          (!reference.partId || reference.partId === target.partId) &&
          referenceHits(reference, target, drawing)
        ) {
          targetIds.add(target.id);
        }
      }
    }
    if (targetIds.size > 0) {
      ties.push({ drawing, targetIds: [...targetIds] });
    } else {
      skipped.push(drawing);
    }
  }
  return { ties, skipped };
}

/**
 * Every assembly a BOM tree shows, rows with no part number included: the
 * sources `tieDrawings` keeps an assembly's drawings off its parts with.
 */
export function bomAssemblySources(nodes: OnshapeBomNode[]): DrawingSource[] {
  const out: DrawingSource[] = [];
  const seen = new Set<string>();
  const walk = (list: OnshapeBomNode[]) => {
    for (const node of list) {
      const source = node.itemSource;
      if (
        source?.documentId &&
        source.elementId &&
        !source.partId &&
        source.wvmId &&
        (source.wvmType === "w" || source.wvmType === "v")
      ) {
        const configuration = normalizeConfiguration(source.configuration);
        const key = [
          source.documentId,
          source.wvmType,
          source.wvmId,
          source.elementId,
          configuration ?? ""
        ].join(SEP);
        if (!seen.has(key)) {
          seen.add(key);
          out.push({
            kind: "assembly",
            documentId: source.documentId,
            wvm: source.wvmType,
            wvmId: source.wvmId,
            elementId: source.elementId,
            configuration
          });
        }
      }
      walk(node.children ?? []);
    }
  };
  walk(nodes);
  return out;
}
