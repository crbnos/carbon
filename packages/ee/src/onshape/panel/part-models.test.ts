// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { OnshapeBomNode } from "./bom";
import { modelExportFor } from "./part-models";

const node = (over: Partial<OnshapeBomNode> = {}): OnshapeBomNode => ({
  index: "1",
  level: 1,
  partNumber: "BRK-010",
  revision: null,
  name: "Bracket",
  description: null,
  quantity: 1,
  itemSource: {
    documentId: "d",
    elementId: "ps",
    partId: "JHD",
    wvmType: "w",
    wvmId: "w1"
  },
  children: [],
  ...over
});

describe("modelExportFor", () => {
  it("exports one part of a Part Studio", () => {
    expect(modelExportFor(node())).toEqual({
      partNumber: "BRK-010",
      kind: "partstudio",
      documentId: "d",
      wvm: "w",
      wvmId: "w1",
      elementId: "ps",
      partId: "JHD",
      configuration: null
    });
  });

  it("exports a row with no part id as an assembly", () => {
    expect(
      modelExportFor(
        node({
          itemSource: {
            documentId: "d",
            elementId: "asm",
            wvmType: "v",
            wvmId: "v1"
          }
        })
      )
    ).toMatchObject({ kind: "assembly", wvm: "v", elementId: "asm" });
  });

  it("normalizes the configuration, the default reading as null", () => {
    expect(
      modelExportFor(
        node({
          itemSource: {
            ...node().itemSource,
            configuration: "default"
          }
        })
      )?.configuration
    ).toBeNull();
    expect(
      modelExportFor(
        node({
          itemSource: {
            ...node().itemSource,
            configuration: "Length%3D40mm"
          }
        })
      )?.configuration
    ).toBe("Length=40mm");
  });

  it("offers nothing for a microversion source", () => {
    expect(
      modelExportFor(
        node({ itemSource: { ...node().itemSource, wvmType: "m" } })
      )
    ).toBeNull();
  });

  it("offers nothing without a part number, document or element", () => {
    expect(modelExportFor(node({ partNumber: null }))).toBeNull();
    expect(modelExportFor(node({ itemSource: null }))).toBeNull();
    expect(
      modelExportFor(
        node({ itemSource: { ...node().itemSource, elementId: undefined } })
      )
    ).toBeNull();
  });
});
