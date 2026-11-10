// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { OnshapeBomNode } from "./bom";
import type { DrawingTarget, OnshapeDrawing } from "./drawings";
import {
  bomAssemblySources,
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
  id: "item",
  kind: "partstudio",
  documentId: "d",
  wvm: "w",
  wvmId: "w1",
  elementId: "ps",
  configuration: null,
  ...over
});

const root = target({ id: "asm-100", kind: "assembly", elementId: "asm" });
const bracket = target({ id: "brk-010", partId: "JHD" });
const plate = target({ id: "plt-020", partId: "JKD" });
const pin = target({ id: "pin-030", elementId: "solo", partId: "JFD" });
const targets = [root, bracket, plate, pin];

const tiedIds = (result: ReturnType<typeof tieDrawings>) =>
  result.ties.map((tie) => tie.targetIds);

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

  it("keeps the version of another document a reference shows", () => {
    const raw = {
      resolvedReferences: [
        {
          targetDocumentId: "lib",
          targetVersionId: "lib-v2",
          targetElementId: "nuts",
          idTag: "JAD"
        },
        {
          targetDocumentId: "lib",
          targetVersionId: "lib-v3",
          targetElementId: "nuts",
          idTag: "JAD"
        }
      ]
    };
    expect(parseDrawingReferences(raw)).toEqual([
      {
        documentId: "lib",
        versionId: "lib-v2",
        elementId: "nuts",
        partId: "JAD"
      },
      {
        documentId: "lib",
        versionId: "lib-v3",
        elementId: "nuts",
        partId: "JAD"
      }
    ]);
  });

  it("reads an answer with no references as none", () => {
    expect(parseDrawingReferences(null)).toEqual([]);
    expect(parseDrawingReferences({ resolvedReferences: [] })).toEqual([]);
    expect(parseDrawingReferences([{ idTag: "JHD" }])).toEqual([]);
  });
});

describe("tieDrawings", () => {
  it("ties a drawing of one part to that part only", () => {
    const result = tieDrawings(
      [drawing({ references: [{ elementId: "ps", partId: "JKD" }] })],
      targets
    );
    expect(tiedIds(result)).toEqual([["plt-020"]]);
  });

  it("ties a drawing of two parts to both", () => {
    const result = tieDrawings(
      [
        drawing({
          references: [
            { elementId: "ps", partId: "JHD" },
            { elementId: "solo", partId: "JFD" }
          ]
        })
      ],
      targets
    );
    expect(tiedIds(result)).toEqual([["brk-010", "pin-030"]]);
  });

  it("ties a drawing of a whole Part Studio to every part of it in the push", () => {
    const result = tieDrawings(
      [drawing({ references: [{ elementId: "ps" }] })],
      targets
    );
    expect(tiedIds(result)).toEqual([["brk-010", "plt-020"]]);
  });

  it("ties a drawing that shows an assembly and its parts to the assembly only", () => {
    const result = tieDrawings(
      [
        drawing({
          references: [{ elementId: "ps", partId: "JHD" }, { elementId: "asm" }]
        })
      ],
      targets
    );
    expect(tiedIds(result)).toEqual([["asm-100"]]);
  });

  it("keeps a drawing of an assembly that takes no files off that assembly's parts", () => {
    const sub = {
      kind: "assembly" as const,
      documentId: "d",
      wvm: "w" as const,
      wvmId: "w1",
      elementId: "sub",
      configuration: null
    };
    const result = tieDrawings(
      [
        drawing({
          references: [{ elementId: "sub" }, { elementId: "ps", partId: "JHD" }]
        })
      ],
      targets,
      [sub]
    );
    expect(result.ties).toEqual([]);
    expect(result.skipped.map((entry) => entry.elementId)).toEqual(["drw"]);
  });

  it("skips a drawing of a part with no row, though its Part Studio has rows", () => {
    const result = tieDrawings(
      [drawing({ references: [{ elementId: "ps", partId: "JZZ" }] })],
      targets
    );
    expect(result.ties).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it("ties a drawing only to rows at its own workspace or version", () => {
    const atVersion = target({
      id: "brk-v1",
      wvm: "v",
      wvmId: "v1",
      partId: "JHD"
    });
    const result = tieDrawings(
      [
        drawing({ references: [{ elementId: "ps", partId: "JHD" }] }),
        drawing({
          wvm: "v",
          wvmId: "v1",
          references: [{ elementId: "ps", partId: "JHD" }]
        })
      ],
      [bracket, atVersion]
    );
    expect(tiedIds(result)).toEqual([["brk-010"], ["brk-v1"]]);
  });

  it("ties a reference into another document to that document's row", () => {
    const linked = target({
      id: "nut-040",
      documentId: "lib",
      wvm: "v",
      wvmId: "lib-v3",
      elementId: "nuts",
      partId: "JAD"
    });
    const result = tieDrawings(
      [
        drawing({
          references: [{ documentId: "lib", elementId: "nuts", partId: "JAD" }]
        })
      ],
      [bracket, linked]
    );
    expect(tiedIds(result)).toEqual([["nut-040"]]);
  });

  it("ties a reference into another document only to that document's row at the version it shows", () => {
    const linked = (wvmId: string) =>
      target({
        id: `nut-${wvmId}`,
        documentId: "lib",
        wvm: "v",
        wvmId,
        elementId: "nuts",
        partId: "JAD"
      });
    const result = tieDrawings(
      [
        drawing({
          references: [
            {
              documentId: "lib",
              versionId: "lib-v2",
              elementId: "nuts",
              partId: "JAD"
            }
          ]
        })
      ],
      [linked("lib-v2"), linked("lib-v3")]
    );
    expect(tiedIds(result)).toEqual([["nut-lib-v2"]]);
  });

  it("keeps a drawing of an assembly outside the push off the parts it shows", () => {
    const result = tieDrawings(
      [
        drawing({
          references: [
            { elementId: "other" },
            { elementId: "ps", partId: "JHD" }
          ]
        })
      ],
      targets,
      [],
      [{ documentId: "d", wvm: "w", wvmId: "w1", elementId: "other" }]
    );
    expect(result.ties).toEqual([]);
    expect(result.skipped.map((entry) => entry.elementId)).toEqual(["drw"]);
  });

  it("matches a configured part only at the configuration the drawing names", () => {
    const blue = target({
      id: "brk-blue",
      partId: "JHD",
      configuration: "Color=Blue"
    });
    const result = tieDrawings(
      [
        drawing({
          references: [
            { elementId: "ps", partId: "JHD", configuration: "Color=Blue" }
          ]
        })
      ],
      [bracket, blue]
    );
    expect(tiedIds(result)).toEqual([["brk-blue"]]);
  });
});

describe("bomAssemblySources", () => {
  const node = (over: Partial<OnshapeBomNode>): OnshapeBomNode => ({
    index: "1",
    level: 1,
    partNumber: null,
    revision: null,
    name: null,
    description: null,
    quantity: 1,
    itemSource: null,
    children: [],
    ...over
  });

  it("lists every sub-assembly, part numbers or not, and no parts", () => {
    const nodes = [
      node({
        partNumber: "ASM-110",
        itemSource: {
          documentId: "d",
          elementId: "sub",
          wvmType: "w",
          wvmId: "w1"
        },
        children: [
          node({
            itemSource: {
              documentId: "d",
              elementId: "inner",
              wvmType: "v",
              wvmId: "v2",
              configuration: "default"
            }
          }),
          node({
            partNumber: "BRK-010",
            itemSource: {
              documentId: "d",
              elementId: "ps",
              partId: "JHD",
              wvmType: "w",
              wvmId: "w1"
            }
          })
        ]
      })
    ];
    expect(bomAssemblySources(nodes)).toEqual([
      {
        kind: "assembly",
        documentId: "d",
        wvm: "w",
        wvmId: "w1",
        elementId: "sub",
        configuration: null
      },
      {
        kind: "assembly",
        documentId: "d",
        wvm: "v",
        wvmId: "v2",
        elementId: "inner",
        configuration: null
      }
    ]);
  });
});
