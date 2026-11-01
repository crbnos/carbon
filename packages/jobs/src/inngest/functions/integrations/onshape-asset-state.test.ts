// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import type {
  AssetRows,
  DrawingRow,
  FileRecords,
  ModelRow,
  SourceStates
} from "./onshape-asset-state";
import {
  currentFiles,
  documentStateKey,
  drawingFileKey,
  drawingPdfPath,
  drawingRowSourceKey,
  outOfDateFiles,
  rowsWithFiles,
  sourceStateReads
} from "./onshape-asset-state";
import { assemblySourceKeyAt, partSourceId } from "./onshape-source-keys";

// Import stub: the package opens Redis and Supabase clients at import.
vi.mock("@carbon/ee/onshape", () => ({
  OnshapeWVMType: { WORKSPACE: "w", VERSION: "v" },
  selectInBatches: vi.fn()
}));

const studio = {
  kind: "partstudio" as const,
  documentId: "d",
  wvm: "w" as const,
  wvmId: "w1",
  elementId: "ps",
  configuration: null
};

const model = (over: Partial<ModelRow> = {}): ModelRow => ({
  ...studio,
  itemId: "brk",
  partNumber: "BRK-010",
  partId: "JHD",
  ...over
});

const drawing = (over: Partial<DrawingRow> = {}): DrawingRow => ({
  itemId: "brk",
  partNumber: "BRK-010",
  documentId: "d",
  wvm: "w",
  wvmId: "w1",
  drawingElementId: "drw",
  drawingMicroversionId: "mv-drawing",
  target: { ...studio, partId: "JHD" },
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

const records = (over: Partial<FileRecords> = {}): FileRecords => ({
  modelUploadIds: { brk: brkModelId },
  modelSources: {},
  drawingKeys: {
    brk: { drw: drawingRowSourceKey(drawing(), states)! }
  },
  storedPaths: [drawingPdfPath("company", drawing())],
  ...over
});

const rows = (over: Partial<AssetRows> = {}): AssetRows => ({
  models: [model()],
  drawings: [drawing()],
  ...over
});

describe("sourceStateReads", () => {
  it("reads each workspace once, whatever its rows, and no version", () => {
    expect(
      sourceStateReads({
        models: [
          model(),
          model({ itemId: "plt", partId: "JKD" }),
          model({ itemId: "len", configuration: "Length=40mm" }),
          model({ itemId: "pin", wvm: "v", wvmId: "v1" })
        ],
        drawings: [
          drawing({
            target: { ...studio, kind: "assembly", elementId: "asm" }
          }),
          drawing({ target: { ...studio, documentId: "lib", wvmId: "w9" } })
        ]
      })
    ).toEqual([
      { documentId: "d", wvmId: "w1" },
      { documentId: "lib", wvmId: "w9" }
    ]);
  });
});

describe("currentFiles", () => {
  it("finds the model and drawing an item already has from the current state", () => {
    expect(currentFiles("company", rows(), states, records())).toEqual({
      models: ["brk"],
      drawings: [drawingFileKey(drawing())]
    });
  });

  it("finds nothing current once the workspace has changed", () => {
    const changed: SourceStates = {
      documents: { [workspaceKey]: { parts: "ws-2", assemblies: "wa-1" } }
    };
    expect(currentFiles("company", rows(), changed, records())).toEqual({
      models: [],
      drawings: []
    });
  });

  it("keeps a part current when only an assembly in the workspace changed", () => {
    const assemblyEdited: SourceStates = {
      documents: { [workspaceKey]: { parts: "ws-1", assemblies: "wa-2" } }
    };
    expect(
      currentFiles("company", rows(), assemblyEdited, records()).models
    ).toEqual(["brk"]);
  });

  it("finds nothing current when Onshape did not report the workspace's state", () => {
    expect(
      currentFiles("company", rows(), { documents: {} }, records())
    ).toEqual({ models: [], drawings: [] });
  });

  it("exports a recorded drawing again once its PDF was deleted from the item", () => {
    expect(
      currentFiles("company", rows(), states, records({ storedPaths: [] }))
        .drawings
    ).toEqual([]);
  });

  it("exports a model again once the item's model was replaced", () => {
    expect(
      currentFiles(
        "company",
        rows(),
        states,
        records({ modelUploadIds: { brk: "manual-upload" } })
      ).models
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
    expect(
      currentFiles(
        "company",
        rows({ models: [sub], drawings: [] }),
        states,
        held
      ).models
    ).toEqual(["sub"]);
  });
});

describe("rowsWithFiles", () => {
  it("keeps only rows whose item holds a model or a stored, recorded drawing", () => {
    const fresh = model({ itemId: "new", partNumber: "NEW-001" });
    const unrecorded = drawing({ drawingElementId: "drw-2" });
    expect(
      rowsWithFiles(
        "company",
        rows({
          models: [model(), fresh],
          drawings: [drawing(), unrecorded]
        }),
        records()
      )
    ).toEqual({ models: [model()], drawings: [drawing()] });
  });
});

describe("outOfDateFiles", () => {
  const none = { models: [], drawings: [] };

  it("names an earlier Onshape export and a drawing recorded at an earlier state", () => {
    const earlier = records({
      modelUploadIds: { brk: "onshape-earlier" },
      drawingKeys: { brk: { drw: "an-earlier-key" } }
    });
    expect(outOfDateFiles("company", rows(), earlier, none)).toEqual({
      models: ["brk"],
      drawings: [drawingFileKey(drawing())]
    });
  });

  it("leaves out current files, a model uploaded by hand, and an item with no file", () => {
    const fresh = model({ itemId: "new", partNumber: "NEW-001" });
    expect(
      outOfDateFiles(
        "company",
        rows({ models: [model(), fresh] }),
        records({ modelUploadIds: { brk: "manual-upload" } }),
        { models: [], drawings: [drawingFileKey(drawing())] }
      )
    ).toEqual(none);
  });
});
