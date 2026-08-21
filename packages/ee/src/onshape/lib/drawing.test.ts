import { describe, expect, it } from "vitest";
import type { OnshapeAppElementReference } from "./client";
import { chooseDrawingModelTarget } from "./drawing";

// This function decides which Carbon part a released drawing's PDF lands on.
// v1 got it wrong by matching part-number suffixes and filed drawings against
// whichever of five items happened to share "-410". The replacement is an id
// lookup, so the remaining risk is entirely in the FILTERING — the reference
// list contains non-model targets, duplicates, and self-references, none of
// which the records label. Each of those is pinned below.

const DOC = "fd15a005d9711c2535b11835";
const ASSEMBLY = "71d063cabedf14392964ab6d";
const BOM_ELEMENT = "7eaf0733dba8077e29eef6d2";
const DRAWING = "3043b4598e6e8d07fa7f3e45";

function ref(
  targetElementId: string,
  overrides: Partial<OnshapeAppElementReference> = {}
): OnshapeAppElementReference {
  return {
    targetDocumentId: DOC,
    targetElementId,
    targetConfiguration: "default",
    referenceType: 0,
    ...overrides
  };
}

/** Only the assembly is a model; the BOM element is not. */
const isModel = (documentId: string, elementId: string) =>
  documentId === DOC && elementId === ASSEMBLY;

describe("chooseDrawingModelTarget", () => {
  it("resolves the real RD-410 shape: 9 records, 2 targets, one survivor", () => {
    // Exactly what the live endpoint returned on 2026-08-21 — five records
    // pointing at the assembly, four at the BOM element embedded on the sheet.
    const references = [
      ...Array.from({ length: 5 }, () => ref(ASSEMBLY)),
      ...Array.from({ length: 4 }, () => ref(BOM_ELEMENT))
    ];

    expect(chooseDrawingModelTarget(references, isModel, DRAWING)).toEqual({
      kind: "one",
      documentId: DOC,
      elementId: ASSEMBLY,
      configuration: "default"
    });
  });

  it("drops the BILLOFMATERIALS element", () => {
    expect(
      chooseDrawingModelTarget([ref(BOM_ELEMENT)], isModel, DRAWING)
    ).toEqual({ kind: "none" });
  });

  it("drops a self-reference", () => {
    const selfIsModel = () => true;
    expect(
      chooseDrawingModelTarget([ref(DRAWING)], selfIsModel, DRAWING)
    ).toEqual({ kind: "none" });
  });

  it("drops records missing either id", () => {
    const references = [
      ref(ASSEMBLY, { targetDocumentId: undefined }),
      ref("", {}),
      { referenceType: 0 } as OnshapeAppElementReference
    ];
    expect(chooseDrawingModelTarget(references, isModel, DRAWING)).toEqual({
      kind: "none"
    });
  });

  it("dedupes on document+element, ignoring the configuration", () => {
    // buildElementExternalId ignores the configuration, so two configured
    // instances are ONE Carbon family. Splitting them here would manufacture an
    // ambiguity the mapping layer does not have.
    const references = [
      ref(ASSEMBLY, { targetConfiguration: "default" }),
      ref(ASSEMBLY, { targetConfiguration: "size=large" })
    ];
    const result = chooseDrawingModelTarget(references, isModel, DRAWING);
    expect(result.kind).toBe("one");
  });

  it("names every target when a drawing documents two models", () => {
    const second = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const bothAreModels = (documentId: string, elementId: string) =>
      documentId === DOC && (elementId === ASSEMBLY || elementId === second);

    expect(
      chooseDrawingModelTarget(
        [ref(ASSEMBLY), ref(second)],
        bothAreModels,
        DRAWING
      )
    ).toEqual({
      kind: "many",
      targets: [
        { documentId: DOC, elementId: ASSEMBLY },
        { documentId: DOC, elementId: second }
      ]
    });
  });

  it("treats a cross-document target as not-a-model", () => {
    // The listing only covers THIS document, so a reference elsewhere cannot be
    // confirmed. Guessing yes would let a foreign BOM element through.
    expect(
      chooseDrawingModelTarget(
        [ref(ASSEMBLY, { targetDocumentId: "some-other-document" })],
        isModel,
        DRAWING
      )
    ).toEqual({ kind: "none" });
  });

  it("survives an empty or absent reference list", () => {
    expect(chooseDrawingModelTarget([], isModel, DRAWING)).toEqual({
      kind: "none"
    });
    expect(
      chooseDrawingModelTarget(
        undefined as unknown as OnshapeAppElementReference[],
        isModel,
        DRAWING
      )
    ).toEqual({ kind: "none" });
  });
});
