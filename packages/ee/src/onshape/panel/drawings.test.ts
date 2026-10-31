// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { DrawingTarget, OnshapeDrawing } from "./drawings";
import {
  elementPartsKey,
  parseDrawingReferences,
  tieDrawings
} from "./drawings";

const drawing = (over: Partial<OnshapeDrawing> = {}): OnshapeDrawing => ({
  documentId: "d",
  wvm: "w",
  wvmId: "w1",
  elementId: "drw",
  name: "Drawing 1",
  microversionId: "mv1",
  references: [],
  ...over
});

const target = (over: Partial<DrawingTarget>): DrawingTarget => ({
  partNumber: "PN",
  kind: "partstudio",
  documentId: "d",
  wvm: "w",
  wvmId: "w1",
  elementId: "ps",
  configuration: null,
  ...over
});

const root = target({
  partNumber: "ASM-100",
  kind: "assembly",
  elementId: "asm"
});
const sub = target({
  partNumber: "ASM-110",
  kind: "assembly",
  elementId: "sub"
});
const bracket = target({ partNumber: "BRK-010", partId: "JHD" });
const plate = target({ partNumber: "PLT-020", partId: "JKD" });
const pin = target({ partNumber: "PIN-030", elementId: "solo", partId: "JFD" });
const targets = [root, sub, bracket, plate, pin];

describe("parseDrawingReferences", () => {
  it("reads the part from idTag, as Onshape's resolvereferences answers", () => {
    // The live shape: no partId field; idTag equals the BOM's itemSource.partId.
    const raw = {
      resolvedReferences: [
        {
          targetDocumentId: "d",
          targetElementId: "ps",
          targetConfiguration: "default",
          idTag: "JHD",
          partIdentity: "{JHD}",
          referenceType: 3
        },
        {
          targetDocumentId: "d",
          targetElementId: "ps",
          targetConfiguration: "default",
          idTag: "JHD",
          referenceType: 3
        },
        { targetElementId: "asm", configuration: "default" }
      ]
    };
    expect(parseDrawingReferences(raw)).toEqual([
      { documentId: "d", elementId: "ps", partId: "JHD", configuration: null },
      { elementId: "asm", configuration: null }
    ]);
  });

  it("reads an answer with no references as none", () => {
    expect(parseDrawingReferences(null)).toEqual([]);
    expect(parseDrawingReferences({ resolvedReferences: [] })).toEqual([]);
    expect(parseDrawingReferences([{ idTag: "JHD" }])).toEqual([]);
  });
});

describe("tieDrawings", () => {
  it("ties a drawing to the assembly it references first", () => {
    const tied = tieDrawings(
      [
        drawing({
          references: [
            { elementId: "ps", partId: "JHD" },
            { elementId: "sub" },
            { elementId: "asm" }
          ]
        })
      ],
      targets
    );
    expect(tied.ties.map((tie) => tie.partNumber)).toEqual(["ASM-110"]);
  });

  it("ties a drawing of one part by its part id", () => {
    const tied = tieDrawings(
      [drawing({ references: [{ elementId: "ps", partId: "JKD" }] })],
      targets
    );
    expect(tied.ties.map((tie) => tie.partNumber)).toEqual(["PLT-020"]);
  });

  it("skips a drawing of a part with no row, though its Part Studio has rows", () => {
    // Elimination would tie it to BRK-010 or PLT-020.
    const tied = tieDrawings(
      [drawing({ references: [{ elementId: "ps", partId: "JZZ" }] })],
      targets
    );
    expect(tied).toEqual({
      ties: [],
      skipped: [{ elementId: "drw", name: "Drawing 1", reason: "not-in-push" }],
      needsParts: []
    });
  });

  it("skips a drawing of two parts, even when only one has a row", () => {
    const tied = tieDrawings(
      [
        drawing({
          references: [
            { elementId: "ps", partId: "JHD" },
            { elementId: "ps", partId: "JZZ" }
          ]
        })
      ],
      targets
    );
    expect(tied.ties).toEqual([]);
    expect(tied.skipped.map((skip) => skip.reason)).toEqual(["several-parts"]);
  });

  it("asks for a Part Studio's parts when a drawing shows all of it", () => {
    const tied = tieDrawings(
      [drawing({ references: [{ elementId: "solo" }] })],
      targets
    );
    expect(tied.ties).toEqual([]);
    expect(tied.needsParts).toEqual([
      {
        documentId: "d",
        wvm: "w",
        wvmId: "w1",
        elementId: "solo",
        configuration: null
      }
    ]);
  });

  it("ties a drawing of a whole Part Studio only when it has one part", () => {
    const solo = elementPartsKey({
      documentId: "d",
      wvm: "w",
      wvmId: "w1",
      elementId: "solo",
      configuration: null
    });
    const studio = elementPartsKey({
      documentId: "d",
      wvm: "w",
      wvmId: "w1",
      elementId: "ps",
      configuration: null
    });
    const parts = new Map([
      [solo, ["JFD"]],
      [studio, ["JHD", "JKD", "JZZ"]]
    ]);
    const tied = tieDrawings(
      [
        drawing({ elementId: "one", references: [{ elementId: "solo" }] }),
        drawing({ elementId: "many", references: [{ elementId: "ps" }] })
      ],
      targets,
      parts
    );
    expect(tied.ties.map((tie) => tie.partNumber)).toEqual(["PIN-030"]);
    expect(tied.skipped).toEqual([
      { elementId: "many", name: "Drawing 1", reason: "several-parts" }
    ]);
    expect(tied.needsParts).toEqual([]);
  });

  it("skips a drawing that shows nothing in the push", () => {
    const tied = tieDrawings(
      [
        drawing({ references: [{ elementId: "elsewhere" }] }),
        drawing({ elementId: "empty" })
      ],
      targets
    );
    expect(tied.skipped.map((skip) => skip.reason)).toEqual([
      "not-in-push",
      "not-in-push"
    ]);
  });

  it("ties each copy of a document used at two states to its own rows, once", () => {
    // The push uses document d in the workspace and at version v1.
    const atVersion = target({
      partNumber: "BRK-010-V",
      partId: "JHD",
      wvm: "v",
      wvmId: "v1"
    });
    const tied = tieDrawings(
      [
        drawing({ references: [{ elementId: "ps", partId: "JHD" }] }),
        drawing({
          wvm: "v",
          wvmId: "v1",
          references: [{ elementId: "ps", partId: "JHD" }]
        }),
        drawing({
          elementId: "loose",
          references: [{ elementId: "elsewhere" }]
        }),
        drawing({
          elementId: "loose",
          wvm: "v",
          wvmId: "v1",
          references: [{ elementId: "elsewhere" }]
        })
      ],
      [bracket, atVersion]
    );
    expect(tied.ties.map((tie) => [tie.partNumber, tie.drawing.wvmId])).toEqual(
      [
        ["BRK-010", "w1"],
        ["BRK-010-V", "v1"]
      ]
    );
    expect(tied.skipped.map((skip) => skip.elementId)).toEqual(["loose"]);
  });

  it("compares configurations only when the reference names one", () => {
    const configured = [
      target({
        partNumber: "BRK-040",
        partId: "JHD",
        configuration: "Length=40mm"
      })
    ];
    expect(
      tieDrawings(
        [drawing({ references: [{ elementId: "ps", partId: "JHD" }] })],
        configured
      ).ties
    ).toHaveLength(1);
    expect(
      tieDrawings(
        [
          drawing({
            references: [
              { elementId: "ps", partId: "JHD", configuration: "Length%3D40mm" }
            ]
          })
        ],
        configured
      ).ties
    ).toHaveLength(1);
    expect(
      tieDrawings(
        [
          drawing({
            references: [
              { elementId: "ps", partId: "JHD", configuration: null }
            ]
          })
        ],
        configured
      ).ties
    ).toHaveLength(0);
  });

  it("ignores a reference to another document's element of the same id", () => {
    const tied = tieDrawings(
      [
        drawing({
          references: [{ documentId: "other", elementId: "ps", partId: "JHD" }]
        })
      ],
      targets
    );
    expect(tied.ties).toEqual([]);
  });
});
