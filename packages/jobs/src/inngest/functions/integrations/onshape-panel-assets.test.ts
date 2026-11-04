// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Events } from "@carbon/lib/events";
import { describe, expect, it, vi } from "vitest";
import { documentStateKey } from "./onshape-asset-state";
import { buildAssetWork, buildDrawingWork } from "./onshape-panel-assets";

vi.mock("@carbon/auth/client.server", () => ({}));
vi.mock("@carbon/ee/onshape", () => ({
  getOnshapeClient: vi.fn(),
  OnshapeApiError: class extends Error {},
  OnshapeAssetTooLargeError: class extends Error {},
  OnshapeWVMType: { WORKSPACE: "w", VERSION: "v" },
  selectInBatches: vi.fn()
}));

type Payload = Events["carbon/onshape-panel-assets"]["data"];

const payload = (over: Partial<Payload> = {}): Payload => ({
  companyId: "company",
  userId: "user",
  planId: "plan",
  models: [
    {
      kind: "partstudio",
      documentId: "d",
      wvm: "w",
      wvmId: "w1",
      elementId: "ps",
      configuration: null,
      itemId: "brk",
      externalId: "d:ps:JHD",
      partNumber: "BRK-010",
      partId: "JHD"
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

  it("names a workspace part's model by its workspace's source state and its part number", () => {
    expect(buildAssetWork(payload(), states, [])).toEqual({
      models: [
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
      ],
      unchanged: 0
    });
  });

  it("leaves out the models the items already have", () => {
    expect(buildAssetWork(payload(), states, ["brk"])).toEqual({
      models: [],
      unchanged: 1
    });
  });

  it("exports a part with no source state when its workspace's state is unknown", () => {
    const work = buildAssetWork(payload(), { documents: {} }, []);
    expect(work.models[0]?.data.sourceMicroversionId).toBeUndefined();
  });
});

describe("buildDrawingWork", () => {
  const target = {
    itemId: "brk",
    partNumber: "BRK-010",
    kind: "partstudio" as const,
    documentId: "d",
    wvm: "w" as const,
    wvmId: "w1",
    elementId: "ps",
    partId: "JHD",
    configuration: null,
    sourceKey: "k1",
    fileName: "Bracket.pdf"
  };
  const drawing = {
    documentId: "d",
    wvm: "w" as const,
    wvmId: "w1",
    drawingElementId: "drw1",
    name: "Bracket",
    microversionId: "mv-1",
    targets: []
  };

  it("translates a drawing once and gives each row the PDF name planned for it", () => {
    const work = buildDrawingWork({ companyId: "company", userId: "user" }, [
      {
        drawing,
        targets: [
          target,
          {
            ...target,
            itemId: "plt",
            partNumber: "PLT-020",
            partId: "JKD",
            fileName: "Bracket (2).pdf"
          }
        ]
      }
    ]);
    expect(work.map((entry) => entry.data)).toEqual([
      {
        companyId: "company",
        userId: "user",
        integrationId: "onshape-v2",
        itemId: "brk",
        sourceDocument: "Part",
        documentId: "d",
        versionId: "w1",
        sourceWvm: "w",
        drawingElementId: "drw1",
        assetBaseName: "Bracket",
        moreItems: [{ itemId: "plt", assetBaseName: "Bracket (2)" }]
      }
    ]);
  });
});
