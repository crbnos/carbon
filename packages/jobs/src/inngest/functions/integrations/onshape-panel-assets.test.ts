// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Events } from "@carbon/lib/events";
import { describe, expect, it, vi } from "vitest";
import { documentStateKey, drawingFileKey } from "./onshape-asset-state";
import { drawingSourceKey } from "./onshape-drawing-source";
import { buildAssetWork } from "./onshape-panel-assets";

vi.mock("@carbon/auth/client.server", () => ({}));
vi.mock("@carbon/ee/onshape", () => ({
  getOnshapeClient: vi.fn(),
  OnshapeApiError: class extends Error {},
  OnshapeAssetTooLargeError: class extends Error {},
  OnshapeWVMType: { WORKSPACE: "w", VERSION: "v" },
  selectInBatches: vi.fn()
}));

type Payload = Events["carbon/onshape-panel-assets"]["data"];

const studio = {
  kind: "partstudio" as const,
  documentId: "d",
  wvm: "w" as const,
  wvmId: "w1",
  elementId: "ps",
  configuration: null
};

const payload = (over: Partial<Payload> = {}): Payload => ({
  companyId: "company",
  userId: "user",
  planId: "plan",
  models: [{ ...studio, itemId: "brk", partNumber: "BRK-010", partId: "JHD" }],
  drawings: [
    {
      itemId: "brk",
      partNumber: "BRK-010",
      documentId: "d",
      wvm: "w",
      wvmId: "w1",
      drawingElementId: "drw",
      drawingMicroversionId: "mv-drawing",
      target: { ...studio, partId: "JHD" }
    }
  ],
  ...over
});

describe("buildAssetWork", () => {
  const states = {
    documents: {
      [documentStateKey({ documentId: "d", wvmId: "w1" })]: {
        parts: "ws-1",
        assemblies: "wa-1"
      }
    }
  };

  const none = { models: [], drawings: [] };

  it("names a workspace part's model by its workspace's source state and its part number", () => {
    expect(buildAssetWork(payload(), states, none).models).toEqual([
      {
        label: "model BRK-010",
        data: {
          companyId: "company",
          userId: "user",
          integrationId: "onshape-v2",
          itemId: "brk",
          sourceDocument: "Part",
          documentId: "d",
          versionId: "w1",
          sourceWvm: "w",
          sourceMicroversionId: "ws-1",
          modelElementId: "ps",
          modelElementKind: "partstudio",
          partId: "JHD",
          assetBaseName: "BRK-010"
        }
      }
    ]);
  });

  it("names a drawing PDF after its part number and drawing, never its revision", () => {
    const [drawing] = buildAssetWork(payload(), states, none).drawings;
    expect(drawing?.data.assetBaseName).toBe("BRK-010-drw");
    expect(drawing?.sourceKey).toBe(
      drawingSourceKey({
        drawingElementId: "drw",
        drawingState: "mv-drawing",
        targetState: "ws-1"
      })
    );
  });

  it("leaves out the files the items already have", () => {
    const work = buildAssetWork(payload(), states, {
      models: ["brk"],
      drawings: [drawingFileKey(payload().drawings[0]!)]
    });
    expect(work).toEqual({
      models: [],
      drawings: [],
      unchangedModels: 1,
      unchangedDrawings: 1
    });
  });

  it("exports a drawing every time when its part's state is unknown", () => {
    const work = buildAssetWork(payload(), { documents: {} }, none);
    expect(work.drawings[0]?.sourceKey).toBeNull();
    expect(work.models[0]?.data.sourceMicroversionId).toBeUndefined();
  });
});
