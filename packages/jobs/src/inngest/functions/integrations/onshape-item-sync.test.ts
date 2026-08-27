import { describe, expect, it } from "vitest";
import {
  drawingIdentifiersFromState,
  itemReleaseKey,
  type ReleasedRevisionCandidate,
  selectRevisionForItem
} from "./onshape-matching";

// The decisions the per-item re-pull makes before it spends an Onshape export
// call, both pure and both pinned here: WHICH released revision belongs to this
// item, and WHETHER a drawing may be re-pulled at all. Everything the job does
// afterwards follows from these two answers, and getting either wrong attaches
// the wrong geometry to a part.
//
// They are defined in onshape-matching.ts (with the rest of the matching
// contract) because that module deliberately loads without the Inngest client or
// env, which is what lets a test import them at all.

type RevisionCandidate = ReleasedRevisionCandidate & {
  documentId: string;
  versionId: string;
  elementId: string;
};

function revision(overrides: Partial<RevisionCandidate>): RevisionCandidate {
  return {
    partNumber: "PRT-002033",
    revision: "A",
    elementType: 0,
    documentId: "doc-1",
    versionId: "ver-1",
    elementId: "el-1",
    ...overrides
  };
}

describe("itemReleaseKey", () => {
  it("uses Carbon's generated key when the item has one", () => {
    expect(
      itemReleaseKey({
        readableId: "PRT-002033",
        revision: "A",
        readableIdWithRevision: "PRT-002033.A"
      })
    ).toBe("PRT-002033.A");
  });

  it("rebuilds the key from readableId + revision when it is absent", () => {
    expect(
      itemReleaseKey({
        readableId: "PRT-002033",
        revision: "B",
        readableIdWithRevision: null
      })
    ).toBe("PRT-002033.B");
  });

  it("treats an unrevisioned item as its bare part number", () => {
    expect(itemReleaseKey({ readableId: "PRT-002033", revision: "0" })).toBe(
      "PRT-002033"
    );
    expect(itemReleaseKey({ readableId: "PRT-002033", revision: null })).toBe(
      "PRT-002033"
    );
  });
});

describe("selectRevisionForItem", () => {
  const itemAtRevisionA = {
    readableId: "PRT-002033",
    revision: "A",
    readableIdWithRevision: "PRT-002033.A"
  };

  it("selects the release whose revision letter is the item's revision", () => {
    const selected = selectRevisionForItem(
      [
        revision({ revision: "A", elementId: "el-a" }),
        revision({ revision: "B", elementId: "el-b" })
      ],
      itemAtRevisionA
    );
    expect(selected?.elementId).toBe("el-a");
  });

  it("selects nothing when only other revision letters are released", () => {
    const selected = selectRevisionForItem(
      [revision({ revision: "B" }), revision({ revision: "C" })],
      itemAtRevisionA
    );
    expect(selected).toBeNull();
  });

  it("selects nothing from an empty revision list", () => {
    expect(selectRevisionForItem([], itemAtRevisionA)).toBeNull();
  });

  it("selects nothing when the part number differs", () => {
    const selected = selectRevisionForItem(
      [revision({ partNumber: "PRT-002034", revision: "A" })],
      itemAtRevisionA
    );
    expect(selected).toBeNull();
  });

  it("accepts an assembly as the item's model", () => {
    const selected = selectRevisionForItem(
      [revision({ elementType: 1, elementId: "el-assembly" })],
      itemAtRevisionA
    );
    expect(selected?.elementId).toBe("el-assembly");
  });

  it("never selects a drawing element released under the same number", () => {
    const selected = selectRevisionForItem(
      [revision({ elementType: 2, elementId: "el-drawing" })],
      itemAtRevisionA
    );
    expect(selected).toBeNull();
  });

  it("skips a drawing to reach the model at the same revision", () => {
    const selected = selectRevisionForItem(
      [
        revision({ elementType: 2, elementId: "el-drawing" }),
        revision({ elementType: 1, elementId: "el-assembly" })
      ],
      itemAtRevisionA
    );
    expect(selected?.elementId).toBe("el-assembly");
  });

  it("never selects an obsoleted revision", () => {
    const selected = selectRevisionForItem(
      [revision({ revision: "A", isObsolete: true })],
      itemAtRevisionA
    );
    expect(selected).toBeNull();
  });

  it("matches an unrevisioned item against a release with no revision letter", () => {
    const selected = selectRevisionForItem(
      [revision({ revision: "0", elementId: "el-unrevisioned" })],
      {
        readableId: "PRT-002033",
        revision: null,
        readableIdWithRevision: "PRT-002033"
      }
    );
    expect(selected?.elementId).toBe("el-unrevisioned");
  });
});

describe("drawingIdentifiersFromState", () => {
  const identifiedRow = {
    documentId: "doc-1",
    versionId: "ver-1",
    elementId: "el-drawing",
    partNumber: "DRW-002033",
    revision: "A",
    releaseState: "Released"
  };

  it("returns the persisted locator when all three identifiers are present", () => {
    expect(drawingIdentifiersFromState(identifiedRow)).toEqual(identifiedRow);
  });

  it("returns nothing when there is no drawing row at all", () => {
    expect(drawingIdentifiersFromState(null)).toBeNull();
    expect(drawingIdentifiersFromState(undefined)).toBeNull();
  });

  it("returns nothing for a row missing any single identifier", () => {
    expect(
      drawingIdentifiersFromState({ ...identifiedRow, documentId: null })
    ).toBeNull();
    expect(
      drawingIdentifiersFromState({ ...identifiedRow, versionId: null })
    ).toBeNull();
    expect(
      drawingIdentifiersFromState({ ...identifiedRow, elementId: null })
    ).toBeNull();
  });

  it("keeps the locator when only the descriptive fields are missing", () => {
    expect(
      drawingIdentifiersFromState({
        ...identifiedRow,
        partNumber: null,
        revision: null,
        releaseState: null
      })
    ).toEqual({
      documentId: "doc-1",
      versionId: "ver-1",
      elementId: "el-drawing",
      partNumber: null,
      revision: null,
      releaseState: null
    });
  });
});
