// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import type {
  DrawingRecords,
  DrawingTargetRow,
  ModelRecords,
  ModelRow,
  SourceStates,
  TiedDrawing
} from "./onshape-asset-state";
import {
  currentModels,
  documentStateKey,
  drawingTargetSourceKey,
  planDrawingFiles,
  sourceStateReads,
  sourceStateStamps
} from "./onshape-asset-state";
import { assemblySourceKeyAt, partSourceId } from "./onshape-source-keys";

// Import stub: the package opens Redis and Supabase clients at import.
vi.mock("@carbon/ee/onshape", () => ({
  OnshapeWVMType: { WORKSPACE: "w", VERSION: "v" },
  selectInBatches: vi.fn()
}));

const model = (over: Partial<ModelRow> = {}): ModelRow => ({
  kind: "partstudio",
  documentId: "d",
  wvm: "w",
  wvmId: "w1",
  elementId: "ps",
  configuration: null,
  itemId: "brk",
  externalId: "d:ps:JHD",
  partNumber: "BRK-010",
  partId: "JHD",
  ...over
});

// One state names every part of the workspace, another every assembly.
const workspaceKey = documentStateKey({ documentId: "d", wvmId: "w1" });
const states: SourceStates = {
  documents: { [workspaceKey]: { parts: "ws-1", assemblies: "wa-1" } }
};

// The model id the part push gives BRK-010 at ws-1.
const brkModelId = partSourceId({
  modelElementKind: "partstudio",
  sourceWvm: "w",
  sourceMicroversionId: "ws-1",
  companyId: "company",
  itemId: "brk",
  documentId: "d",
  versionId: "w1",
  modelElementId: "ps",
  partId: "JHD"
});

const records = (over: Partial<ModelRecords> = {}): ModelRecords => ({
  modelUploadIds: { brk: brkModelId },
  modelSources: {},
  ...over
});

describe("sourceStateReads", () => {
  it("reads each workspace once, whatever its rows, and no version", () => {
    expect(
      sourceStateReads([
        model(),
        model({ itemId: "plt", partId: "JKD" }),
        model({ itemId: "len", configuration: "Length=40mm" }),
        model({ itemId: "sub", kind: "assembly", elementId: "asm" }),
        model({ itemId: "pin", wvm: "v", wvmId: "v1" }),
        model({ itemId: "lib", documentId: "lib", wvmId: "w9" })
      ])
    ).toEqual([
      { documentId: "d", wvmId: "w1" },
      { documentId: "lib", wvmId: "w9" }
    ]);
  });
});

describe("currentModels", () => {
  it("finds the model an item already has from the current state", () => {
    expect(currentModels("company", [model()], states, records())).toEqual([
      "brk"
    ]);
  });

  it("finds nothing current once the workspace's parts have changed", () => {
    const changed: SourceStates = {
      documents: { [workspaceKey]: { parts: "ws-2", assemblies: "wa-1" } }
    };
    expect(currentModels("company", [model()], changed, records())).toEqual([]);
  });

  it("keeps a part current when only an assembly in the workspace changed", () => {
    const assemblyEdited: SourceStates = {
      documents: { [workspaceKey]: { parts: "ws-1", assemblies: "wa-2" } }
    };
    expect(
      currentModels("company", [model()], assemblyEdited, records())
    ).toEqual(["brk"]);
  });

  it("finds nothing current when Onshape did not report the workspace's state", () => {
    expect(
      currentModels("company", [model()], { documents: {} }, records())
    ).toEqual([]);
  });

  it("exports a model again once the item's model was replaced", () => {
    expect(
      currentModels(
        "company",
        [model()],
        states,
        records({ modelUploadIds: { brk: "manual-upload" } })
      )
    ).toEqual([]);
  });

  it("finds a sub-assembly model current through its recorded source", () => {
    const sub = model({
      kind: "assembly",
      itemId: "sub",
      partNumber: "ASM-110",
      elementId: "asm",
      partId: undefined
    });
    const source = assemblySourceKeyAt(
      { documentId: "d", sourceWvm: "w", modelElementId: "asm" },
      "wa-1"
    );
    const held = records({
      modelUploadIds: { sub: "model-sub" },
      modelSources: {
        sub: { externalId: source, metadata: { modelUploadId: "model-sub" } }
      }
    });
    expect(currentModels("company", [sub], states, held)).toEqual(["sub"]);
  });
});

describe("sourceStateStamps", () => {
  it("records a workspace part's parts state, the value a part push compares", () => {
    expect(sourceStateStamps([model()], states, new Set(["brk"]))).toEqual([
      {
        itemId: "brk",
        externalId: "d:ps:JHD",
        patch: { microversionId: "ws-1", modelVersionId: null }
      }
    ]);
  });

  it("records a version part's version id and clears the workspace state", () => {
    const pin = model({
      itemId: "pin",
      externalId: "lib:ps:JKD",
      documentId: "lib",
      wvm: "v",
      wvmId: "v3",
      partId: "JKD"
    });
    expect(sourceStateStamps([pin], states, new Set(["pin"]))).toEqual([
      {
        itemId: "pin",
        externalId: "lib:ps:JKD",
        patch: { microversionId: null, modelVersionId: "v3" }
      }
    ]);
  });

  it("stamps only items that hold their model, and no assembly", () => {
    const sub = model({
      kind: "assembly",
      itemId: "sub",
      elementId: "asm",
      partId: undefined
    });
    const failed = model({ itemId: "plt", partId: "JKD" });
    expect(sourceStateStamps([sub, failed], states, new Set(["sub"]))).toEqual(
      []
    );
  });

  it("stamps nothing for a workspace whose state Onshape did not report", () => {
    expect(
      sourceStateStamps([model()], { documents: {} }, new Set(["brk"]))
    ).toEqual([]);
  });
});

describe("planDrawingFiles", () => {
  const states: SourceStates = {
    documents: { [workspaceKey]: { parts: "ws-1", assemblies: "wa-1" } }
  };
  const bracket: DrawingTargetRow = {
    itemId: "brk",
    partNumber: "BRK-010",
    kind: "partstudio",
    documentId: "d",
    wvm: "w",
    wvmId: "w1",
    elementId: "ps",
    partId: "JHD",
    configuration: null
  };
  const plate: DrawingTargetRow = {
    ...bracket,
    itemId: "plt",
    partNumber: "PLT-020",
    partId: "JKD"
  };
  const drawing = (over: Partial<TiedDrawing> = {}): TiedDrawing => ({
    documentId: "d",
    wvm: "w",
    wvmId: "w1",
    drawingElementId: "drw",
    name: "Bracket drawing",
    microversionId: "mv-1",
    targets: [bracket, plate],
    ...over
  });
  // The bracket holds the drawing's current PDF under `fileName`.
  const held = (fileName = "Bracket drawing.pdf"): DrawingRecords => ({
    records: {
      brk: {
        drw: {
          sourceKey: drawingTargetSourceKey(drawing(), bracket, states),
          fileName
        }
      }
    },
    files: { brk: [fileName] }
  });
  const none: DrawingRecords = { records: {}, files: {} };

  it("exports a new drawing once for every row it shows and records its name first", () => {
    const tied = drawing();
    expect(planDrawingFiles([tied], states, none)).toEqual({
      exports: [
        {
          drawing: tied,
          targets: [
            {
              ...bracket,
              sourceKey: drawingTargetSourceKey(tied, bracket, states),
              fileName: "Bracket drawing.pdf"
            },
            {
              ...plate,
              sourceKey: drawingTargetSourceKey(tied, plate, states),
              fileName: "Bracket drawing.pdf"
            }
          ]
        }
      ],
      placements: [
        {
          itemId: "brk",
          drawingElementId: "drw",
          from: null,
          record: { sourceKey: null, fileName: "Bracket drawing.pdf" }
        },
        {
          itemId: "plt",
          drawingElementId: "drw",
          from: null,
          record: { sourceKey: null, fileName: "Bracket drawing.pdf" }
        }
      ],
      unchanged: 0,
      renamed: 0
    });
  });

  it("leaves out a row that holds the PDF from the same drawing and part state", () => {
    const plan = planDrawingFiles([drawing()], states, held());
    expect(plan.unchanged).toBe(1);
    expect(plan.exports[0]!.targets.map((t) => t.itemId)).toEqual(["plt"]);
    expect(plan.placements.map((p) => p.itemId)).toEqual(["plt"]);
  });

  it("exports again when the drawing changed since the recorded export", () => {
    const plan = planDrawingFiles(
      [drawing({ microversionId: "mv-2", targets: [bracket] })],
      states,
      held()
    );
    expect(plan.exports[0]!.targets.map((t) => t.itemId)).toEqual(["brk"]);
    expect(plan.placements).toEqual([]);
  });

  it("exports again when the PDF was deleted from the item", () => {
    const plan = planDrawingFiles([drawing({ targets: [bracket] })], states, {
      ...held(),
      files: {}
    });
    expect(plan.unchanged).toBe(0);
    expect(plan.exports).toHaveLength(1);
  });

  it("renames the PDF of a renamed drawing without exporting it", () => {
    const plan = planDrawingFiles(
      [drawing({ name: "Bracket", targets: [bracket] })],
      states,
      held()
    );
    expect(plan).toEqual({
      exports: [],
      placements: [
        {
          itemId: "brk",
          drawingElementId: "drw",
          from: "Bracket drawing.pdf",
          record: {
            sourceKey: drawingTargetSourceKey(drawing(), bracket, states),
            fileName: "Bracket.pdf"
          }
        }
      ],
      unchanged: 0,
      renamed: 1
    });
  });

  it("moves the old PDF of a renamed, changed drawing before exporting it", () => {
    const plan = planDrawingFiles(
      [
        drawing({ name: "Bracket", microversionId: "mv-2", targets: [bracket] })
      ],
      states,
      held()
    );
    expect(plan.placements[0]!.from).toBe("Bracket drawing.pdf");
    expect(plan.exports[0]!.targets[0]!.fileName).toBe("Bracket.pdf");
    expect(plan.renamed).toBe(0);
  });

  it("does not export again a PDF that was too large for the same state", () => {
    const records = held();
    records.records.brk!.drw!.tooLarge = true;
    const plan = planDrawingFiles([drawing({ targets: [bracket] })], states, {
      ...records,
      files: {}
    });
    expect(plan).toEqual({
      exports: [],
      placements: [],
      unchanged: 1,
      renamed: 0
    });
  });

  it("always exports when the part's workspace state is unknown", () => {
    const plan = planDrawingFiles(
      [drawing({ targets: [bracket] })],
      { documents: {} },
      none
    );
    expect(plan.exports[0]!.targets).toEqual([
      { ...bracket, sourceKey: null, fileName: "Bracket drawing.pdf" }
    ]);
  });

  it("keys a version drawing by the version, whatever the workspace does", () => {
    const atVersion = { ...bracket, wvm: "v" as const, wvmId: "v3" };
    const tied = drawing({
      wvm: "v",
      wvmId: "v3",
      microversionId: null,
      targets: [atVersion]
    });
    expect(drawingTargetSourceKey(tied, atVersion, { documents: {} })).toBe(
      drawingTargetSourceKey(tied, atVersion, states)
    );
    expect(drawingTargetSourceKey(tied, atVersion, states)).not.toBeNull();
  });
});

describe("sourceStateReads with drawing rows", () => {
  it("reads each workspace once across models and drawing rows, and no version", () => {
    expect(
      sourceStateReads([
        model(),
        { documentId: "d", wvm: "w", wvmId: "w1" },
        { documentId: "root", wvm: "w", wvmId: "rw" },
        { documentId: "lib", wvm: "v", wvmId: "v3" }
      ])
    ).toEqual([
      { documentId: "d", wvmId: "w1" },
      { documentId: "root", wvmId: "rw" }
    ]);
  });
});
