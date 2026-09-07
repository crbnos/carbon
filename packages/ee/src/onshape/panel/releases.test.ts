import { describe, expect, it } from "vitest";
import type { ReleaseRevisionLike } from "./releases";
import { groupRevisionsIntoReleases, resolveReleaseStates } from "./releases";

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

    const pushed = resolveReleaseStates(releases, [
      { id: "item-1", readableId: "WB-100", revision: "A" },
      { id: "item-3", readableId: "PAD-005", revision: "A" }
    ]);
    expect(pushed[0]?.state).toBe("pushed");

    expect(resolveReleaseStates(releases, [])[0]?.state).toBe("not-pushed");
  });

  it("ignores drawings when computing the release state", () => {
    const resolved = resolveReleaseStates(releases, [
      { id: "item-1", readableId: "WB-100", revision: "A" },
      { id: "item-3", readableId: "PAD-005", revision: "A" }
      // No DRW-001 item anywhere — state must still be pushed.
    ]);
    expect(resolved[0]?.state).toBe("pushed");
    expect(
      resolved[0]?.items.find((i) => i.partNumber === "DRW-001")?.itemId
    ).toBeNull();
  });
});
