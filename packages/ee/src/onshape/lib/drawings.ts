// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type {
  DrawingDocument,
  DrawingReference,
  OnshapeDrawing
} from "../panel/drawings";
import { parseDrawingReferences } from "../panel/drawings";
import type { OnshapeClient } from "./client";
import { type OnshapeDocument, OnshapeWVMType } from "./document.type";
import {
  cacheReferences,
  drawingState,
  getCachedReferences
} from "./drawing-references-cache";
import { ONSHAPE_DRAWING_DATA_TYPE, OnshapeElementType } from "./element.type";

// The two Onshape reads behind a push's drawings: the drawings of a document
// state (one element list), and what each one shows (one read per drawing,
// cached per drawing state).

function onshapeDocument(document: DrawingDocument): OnshapeDocument {
  return {
    documentId: document.documentId,
    wvm:
      document.wvm === "w" ? OnshapeWVMType.WORKSPACE : OnshapeWVMType.VERSION,
    wvmId: document.wvmId
  };
}

/** The drawings of one workspace or version, with what they show not yet read. */
export async function listDrawings(
  client: Pick<OnshapeClient, "getElementsIn">,
  document: DrawingDocument
): Promise<OnshapeDrawing[]> {
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
        typeof row.microversionId === "string" ? row.microversionId : null,
      references: []
    }));
}

/**
 * What a drawing shows: the cached answer at the drawing's state, else one
 * Onshape read, cached for the next push.
 */
export async function readDrawingReferences(
  client: Pick<OnshapeClient, "resolveAppElementReferences">,
  companyId: string,
  drawing: OnshapeDrawing
): Promise<DrawingReference[]> {
  const key = {
    companyId,
    documentId: drawing.documentId,
    elementId: drawing.elementId,
    state: drawingState(drawing)
  };
  const cached = await getCachedReferences(key);
  if (cached) return cached.references;
  const references = parseDrawingReferences(
    await client.resolveAppElementReferences(
      onshapeDocument(drawing),
      drawing.elementId
    )
  );
  await cacheReferences(key, { references });
  return references;
}
