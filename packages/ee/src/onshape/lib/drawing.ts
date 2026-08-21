// Joining a released Onshape DRAWING to the Carbon item its model produced.
//
// v1 matched a drawing to its model by stripping the part number to a shared
// suffix and `ILIKE '%<suffix>'`. That is disproved on real data: RD-410,
// DRW-410 and PK-410 all reduce to "-410", matching five items across two
// parts. The mechanism is unsalvageable rather than buggy, so v2 refused
// drawings outright until this file existed.
//
// The join is an id lookup. `appelements/.../references` names the elements a
// drawing's views are taken from, and `{targetDocumentId}:{targetElementId}` is
// exactly `buildElementExternalId`'s format — a primary-key lookup into
// `externalIntegrationMapping`.
//
// Two things the reference records CANNOT tell us, both checked live:
//
//   1. Which target is a model. Every record carries `referenceType: 0`, for
//      the assembly and for the embedded BILLOFMATERIALS element alike, and
//      every other discriminating field is null. Element types come from the
//      document's element listing instead.
//   2. Which REVISION. The element mapping is revision-agnostic by
//      construction, so attaching at the element would put revision A's drawing
//      on the item at revision C. The released revision narrows it, through the
//      same `resolveBomRow` the BOM import uses.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBomRow } from "./bom";
import type { OnshapeAppElementReference, OnshapeClient } from "./client";
import { readItemsForElementIncludingParts } from "./mapping";

/**
 * Onshape's `dataType` for a drawing element. The `/elements` listing reports a
 * drawing's `elementType` as the STRING `APPLICATION` — not `DRAWING`, which is
 * the revisions API's numeric scheme in string form and matches nothing here —
 * so the dataType is what actually identifies one. Confirmed live 2026-08-21.
 */
export const ONSHAPE_DRAWING_DATA_TYPE = "onshape-app/drawing";

/** The listing's string element types that represent a MODEL. */
const MODEL_ELEMENT_TYPES = new Set(["PARTSTUDIO", "ASSEMBLY"]);

export interface OnshapeListedElement {
  id?: string;
  name?: string;
  elementType?: string;
  dataType?: string;
  [key: string]: unknown;
}

export type DrawingTargetResolution =
  | {
      kind: "one";
      documentId: string;
      elementId: string;
      configuration?: string;
    }
  | { kind: "none" }
  | {
      kind: "many";
      targets: Array<{ documentId: string; elementId: string }>;
    };

/**
 * Pick the ONE model element a drawing documents.
 *
 * Pure and unit-tested: this is where a wrong answer attaches a PDF to the
 * wrong part, and it is cheap to pin.
 *
 * `targetConfiguration` is deliberately NOT part of the dedupe key.
 * `buildElementExternalId` ignores the configuration today, so two configured
 * instances of one element are one Carbon family — treating them as two targets
 * here would manufacture an ambiguity the mapping layer does not have.
 */
export function chooseDrawingModelTarget(
  references: OnshapeAppElementReference[],
  isModelElement: (documentId: string, elementId: string) => boolean,
  drawingElementId?: string
): DrawingTargetResolution {
  const byKey = new Map<
    string,
    { documentId: string; elementId: string; configuration?: string }
  >();

  for (const reference of references ?? []) {
    const documentId = reference?.targetDocumentId;
    const elementId = reference?.targetElementId;
    if (typeof documentId !== "string" || !documentId) continue;
    if (typeof elementId !== "string" || !elementId) continue;
    // A drawing that references itself is not documenting itself.
    if (drawingElementId && elementId === drawingElementId) continue;
    if (!isModelElement(documentId, elementId)) continue;

    const key = `${documentId}:${elementId}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      documentId,
      elementId,
      configuration:
        typeof reference.targetConfiguration === "string"
          ? reference.targetConfiguration
          : undefined
    });
  }

  const targets = [...byKey.values()];
  if (targets.length === 0) return { kind: "none" };
  if (targets.length === 1) return { kind: "one", ...targets[0]! };
  return {
    kind: "many",
    targets: targets.map(({ documentId, elementId }) => ({
      documentId,
      elementId
    }))
  };
}

export type DrawingModelItemResult =
  | { ok: true; itemId: string }
  | {
      ok: false;
      reason:
        | "drawing-references-no-model"
        | "drawing-references-many"
        | "drawing-model-unmapped"
        | "drawing-model-revision-missing"
        | "drawing-model-ambiguous";
      message: string;
    };

/**
 * Which model elements exist in a document version, as a lookup plus the
 * drawings found alongside them.
 *
 * Listed by `dataType`, NOT by passing `?elementType=DRAWING` to `getElements`:
 * the listing calls a drawing `APPLICATION`, so that filter returns nothing.
 */
export async function listDocumentElements(
  client: OnshapeClient,
  args: { documentId: string; wvm: "w" | "v" | "m"; wvmId: string }
): Promise<{
  isModelElement: (documentId: string, elementId: string) => boolean;
  drawings: Array<{ elementId: string; name?: string }>;
}> {
  const listed = (await client.getElements({
    documentId: args.documentId,
    // The client's OnshapeDocument type carries the enum; the values are the
    // same single letters.
    wvm: args.wvm as never,
    wvmId: args.wvmId
  })) as OnshapeListedElement[] | { items?: OnshapeListedElement[] };

  const elements = Array.isArray(listed) ? listed : (listed?.items ?? []);

  const modelIds = new Set<string>();
  const drawings: Array<{ elementId: string; name?: string }> = [];
  for (const element of elements) {
    if (!element?.id) continue;
    if (element.elementType && MODEL_ELEMENT_TYPES.has(element.elementType)) {
      modelIds.add(`${args.documentId}:${element.id}`);
    }
    if (element.dataType === ONSHAPE_DRAWING_DATA_TYPE) {
      drawings.push({ elementId: element.id, name: element.name });
    }
  }

  return {
    // A reference into ANOTHER document cannot be checked against this listing.
    // Treat it as not-a-model rather than fetching every referenced document:
    // a cross-document drawing is out of scope, and guessing yes would let the
    // BOM element through whenever it lived elsewhere.
    isModelElement: (documentId: string, elementId: string) =>
      modelIds.has(`${documentId}:${elementId}`),
    drawings
  };
}

/**
 * Resolve a drawing element to the ONE Carbon item it documents, at the
 * released revision.
 */
export async function resolveDrawingModelItem(
  client: OnshapeClient,
  carbon: SupabaseClient<Database>,
  args: {
    companyId: string;
    documentId: string;
    wvm: "w" | "v" | "m";
    wvmId: string;
    drawingElementId: string;
    releasedRevision: string;
    /** Pass the document listing when the caller already has it. */
    isModelElement?: (documentId: string, elementId: string) => boolean;
  }
): Promise<DrawingModelItemResult> {
  const references = await client.getAppElementReferences(
    args.documentId,
    args.wvm,
    args.wvmId,
    args.drawingElementId
  );

  const isModelElement =
    args.isModelElement ??
    (
      await listDocumentElements(client, {
        documentId: args.documentId,
        wvm: args.wvm,
        wvmId: args.wvmId
      })
    ).isModelElement;

  const chosen = chooseDrawingModelTarget(
    references,
    isModelElement,
    args.drawingElementId
  );

  if (chosen.kind === "none") {
    return {
      ok: false,
      reason: "drawing-references-no-model",
      message:
        "This Onshape drawing does not reference a part studio or assembly, so Carbon cannot tell which item its PDF belongs to."
    };
  }

  if (chosen.kind === "many") {
    return {
      ok: false,
      reason: "drawing-references-many",
      message: `This Onshape drawing documents more than one model (${chosen.targets
        .map((target) => target.elementId)
        .join(", ")}), so Carbon cannot tell which item its PDF belongs to.`
    };
  }

  const candidates = await readItemsForElementIncludingParts(carbon, {
    companyId: args.companyId,
    documentId: chosen.documentId,
    elementId: chosen.elementId
  });

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "drawing-model-unmapped",
      message:
        "The model this Onshape drawing documents is not linked to a Carbon item yet. Link it, or import its assembly, first."
    };
  }

  // The element mapping spans every revision of the part, so the element alone
  // is a FAMILY. Narrowing by the released revision is what stops revision A's
  // drawing landing on the item at revision C.
  const items = await carbon
    .from("item")
    .select("id, revision")
    .in(
      "id",
      candidates.map((candidate) => candidate.itemId)
    )
    .eq("companyId", args.companyId);

  if (items.error) {
    throw new Error(
      `Failed to read the items this Onshape drawing could belong to: ${items.error.message}`
    );
  }

  const resolution = resolveBomRow(
    args.releasedRevision,
    (items.data ?? []).map((item) => ({
      itemId: item.id,
      revision: item.revision
    }))
  );

  if (resolution.kind === "matched") {
    return { ok: true, itemId: resolution.itemId };
  }

  if (resolution.kind === "ambiguous") {
    return {
      ok: false,
      // Distinct from drawing-references-many, which is about two TARGET
      // ELEMENTS. This is one element whose family has several members at the
      // same revision — a different problem, and the message has to say so.
      reason: "drawing-model-ambiguous",
      message:
        "Several Carbon items are linked to the model this Onshape drawing documents, at the same revision, so its PDF has no single home."
    };
  }

  return {
    ok: false,
    reason: "drawing-model-revision-missing",
    message: `Carbon has the model this Onshape drawing documents, but not at revision ${
      args.releasedRevision || "(initial)"
    }.`
  };
}
