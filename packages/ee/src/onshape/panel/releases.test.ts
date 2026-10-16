// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { ReleaseRevisionLike } from "./releases";
import {
  drawingModels,
  groupRevisionsIntoReleases,
  releaseBomKey,
  releaseDrawingFileName,
  releaseExportSelection,
  resolveReleaseStates
} from "./releases";

function revision(
  over: Partial<ReleaseRevisionLike> = {}
): ReleaseRevisionLike {
  return {
    partNumber: "WB-100",
    revision: "A",
    elementType: 1,
    documentId: "d1",
    versionId: "v1",
    elementId: "e-asm",
    releaseId: "rel-1",
    releaseName: "Initial release",
    releaseCreatedDate: "2026-08-28T10:00:00Z",
    ...over
  };
}

describe("groupRevisionsIntoReleases", () => {
  it("groups by releaseId, newest release first, assemblies before parts before drawings", () => {
    const releases = groupRevisionsIntoReleases([
      revision({
        partNumber: "PAD-005",
        elementType: 0,
        elementId: "e-ps"
      }),
      revision({
        partNumber: "DRW-001",
        elementType: 2,
        elementId: "e-drw"
      }),
      revision(),
      revision({
        partNumber: "WB-100",
        revision: "B",
        releaseId: "rel-2",
        releaseName: "Rev B",
        releaseCreatedDate: "2026-08-29T10:00:00Z",
        versionId: "v2"
      })
    ]);

    expect(releases.map((r) => r.releaseId)).toEqual(["rel-2", "rel-1"]);
    expect(releases[1]?.releaseName).toBe("Initial release");
    expect(releases[1]?.items.map((i) => i.partNumber)).toEqual([
      "WB-100",
      "PAD-005",
      "DRW-001"
    ]);
  });

  it("falls back to a synthetic key when releaseId is missing", () => {
    const releases = groupRevisionsIntoReleases([
      revision({ releaseId: null, releaseName: null }),
      revision({
        partNumber: "PAD-005",
        releaseId: null,
        releaseName: null,
        elementType: 0
      })
    ]);
    expect(releases).toHaveLength(2);
    expect(releases.map((r) => r.releaseId).sort()).toEqual([
      "rev:PAD-005:A",
      "rev:WB-100:A"
    ]);
  });
});

describe("resolveReleaseStates", () => {
  const releases = groupRevisionsIntoReleases([
    revision(),
    revision({ partNumber: "PAD-005", elementType: 0, elementId: "e-ps" }),
    revision({ partNumber: "DRW-001", elementType: 2, elementId: "e-drw" })
  ]);

  it("marks a release pushed only when every model item's letter exists", () => {
    const partial = resolveReleaseStates(releases, [
      { id: "item-1", readableId: "WB-100", revision: "A" },
      // PAD-005 exists in Carbon, but not at the released letter.
      { id: "item-2", readableId: "PAD-005", revision: "0" }
    ]);
    expect(partial[0]?.state).toBe("partial");
    expect(
      partial[0]?.items.find((i) => i.partNumber === "WB-100")?.state
    ).toBe("in-carbon");
    expect(
      partial[0]?.items.find((i) => i.partNumber === "PAD-005")?.state
    ).toBe("missing");

    const pushed = resolveReleaseStates(
      releases,
      [
        { id: "item-1", readableId: "WB-100", revision: "A" },
        { id: "item-3", readableId: "PAD-005", revision: "A" }
      ],
      new Set(["DRW-001-A.pdf"])
    );
    expect(pushed[0]?.state).toBe("pushed");

    expect(resolveReleaseStates(releases, [])[0]?.state).toBe("not-pushed");
  });

  it("counts a drawing as in Carbon once its PDF has landed", () => {
    const models = [
      { id: "item-1", readableId: "WB-100", revision: "A" },
      { id: "item-3", readableId: "PAD-005", revision: "A" }
    ];
    // Models pushed, drawing export still running: partial until a refresh.
    const pending = resolveReleaseStates(releases, models);
    expect(pending[0]?.state).toBe("partial");
    expect(
      pending[0]?.items.find((i) => i.partNumber === "DRW-001")?.state
    ).toBe("missing");

    const landed = resolveReleaseStates(
      releases,
      models,
      new Set([
        releaseDrawingFileName({ partNumber: "DRW-001", revision: "A" })
      ])
    );
    expect(landed[0]?.state).toBe("pushed");
    const drawing = landed[0]?.items.find((i) => i.partNumber === "DRW-001");
    expect(drawing?.state).toBe("in-carbon");
    expect(drawing?.itemId).toBeNull();
  });

  it("reads a drawing-only release from its PDFs alone", () => {
    const drawingOnly = groupRevisionsIntoReleases([
      revision({ partNumber: "DRW-001", elementType: 2, elementId: "e-drw" })
    ]);
    expect(resolveReleaseStates(drawingOnly, [])[0]?.state).toBe("not-pushed");
    expect(
      resolveReleaseStates(drawingOnly, [], new Set(["DRW-001-A.pdf"]))[0]
        ?.state
    ).toBe("pushed");
  });
});

describe("releaseExportSelection", () => {
  it("exports a released part by its partId and configuration", () => {
    expect(
      releaseExportSelection({
        elementType: 0,
        partId: "JHD",
        configuration: "size%3DLarge"
      })
    ).toEqual({ ok: true, partId: "JHD", configuration: "size%3DLarge" });
  });

  it("skips a Part Studio release that names no single part", () => {
    expect(releaseExportSelection({ elementType: 0, partId: null }).ok).toBe(
      false
    );
    expect(
      releaseExportSelection({ elementType: 0, partId: "JHD,JKD" }).ok
    ).toBe(false);
  });

  it("exports an assembly without a partId, dropping the default configuration", () => {
    expect(
      releaseExportSelection({ elementType: 1, configuration: "default" })
    ).toEqual({ ok: true });
  });
});

describe("drawingModels", () => {
  const pkgItem = (
    id: string,
    parentId: string | null,
    elementType: number,
    partNumber: string | null,
    revision: string | null = "C"
  ) => ({
    id,
    parentId,
    elementType,
    elementId: `e-${id}`,
    partNumber,
    revision
  });

  it("maps each drawing to the first model listed under it", () => {
    expect(
      drawingModels([
        pkgItem("drw", null, 2, "WB-100-DWG"),
        pkgItem("asm", "drw", 1, "WB-100"),
        pkgItem("prt", "asm", 0, "PAD-005"),
        pkgItem("lone", null, 2, "LONE-DWG")
      ])
    ).toEqual(new Map([["e-drw", { partNumber: "WB-100", revision: "C" }]]));
  });

  it("skips a model under the drawing that has no part number", () => {
    expect(
      drawingModels([
        pkgItem("drw", null, 2, "WB-100-DWG"),
        pkgItem("asm", "drw", 1, null),
        pkgItem("prt", "drw", 0, "PAD-005", null)
      ])
    ).toEqual(new Map([["e-drw", { partNumber: "PAD-005", revision: null }]]));
  });
});

describe("releaseBomKey", () => {
  it("keys the default configuration by the element id alone", () => {
    expect(releaseBomKey({ elementId: "e-asm" })).toBe("e-asm");
    expect(releaseBomKey({ elementId: "e-asm", configuration: null })).toBe(
      "e-asm"
    );
    expect(
      releaseBomKey({ elementId: "e-asm", configuration: " default " })
    ).toBe("e-asm");
  });

  it("gives two configurations of one element different keys", () => {
    const long = releaseBomKey({
      elementId: "e-asm",
      configuration: "Length=100+mm"
    });
    const short = releaseBomKey({
      elementId: "e-asm",
      configuration: "Length=50+mm"
    });
    expect(long).toBe("e-asm:Length=100+mm");
    expect(short).not.toBe(long);
  });

  it("matches an encoded and a decoded configuration", () => {
    expect(
      releaseBomKey({ elementId: "e-asm", configuration: "Size%3DLarge" })
    ).toBe(releaseBomKey({ elementId: "e-asm", configuration: "Size=Large" }));
  });
});
