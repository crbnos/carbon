import { describe, expect, it } from "vitest";
import {
  buildElementExternalId,
  isSameElementRef,
  mergeElementMappingMetadata,
  parseElementExternalId
} from "./mapping";

// These helpers ARE the v2 join key. A wrong id here either fails to match an
// item that should match (silent no-op sync) or matches the wrong one (a BOM
// written onto someone else's part), so the edge cases are pinned rather than
// left to convention.

describe("buildElementExternalId", () => {
  it("addresses a subassembly with document + element", () => {
    expect(
      buildElementExternalId({ documentId: "d1a2b3", elementId: "e4c5d6" })
    ).toBe("d1a2b3:e4c5d6");
  });

  it("addresses a part with document + element + part", () => {
    expect(
      buildElementExternalId({
        documentId: "d1a2b3",
        elementId: "e4c5d6",
        partId: "JHD"
      })
    ).toBe("d1a2b3:e4c5d6:JHD");
  });

  it("treats a null, undefined or empty partId as a subassembly", () => {
    const subassembly = "d1a2b3:e4c5d6";
    expect(
      buildElementExternalId({
        documentId: "d1a2b3",
        elementId: "e4c5d6",
        partId: null
      })
    ).toBe(subassembly);
    expect(
      buildElementExternalId({
        documentId: "d1a2b3",
        elementId: "e4c5d6",
        partId: undefined
      })
    ).toBe(subassembly);
    expect(
      buildElementExternalId({
        documentId: "d1a2b3",
        elementId: "e4c5d6",
        partId: ""
      })
    ).toBe(subassembly);
  });

  it("leaves ordinary Onshape ids unescaped so the id stays readable", () => {
    const id = buildElementExternalId({
      documentId: "1f2e3d4c5b6a7988",
      elementId: "0a1b2c3d4e5f6071"
    });
    expect(id).toBe("1f2e3d4c5b6a7988:0a1b2c3d4e5f6071");
  });

  it("escapes a component containing the separator so it cannot forge another id", () => {
    // Without escaping, partId "e9:XX" on element e4 would build the same
    // string as element "e4:e9" with partId "XX" — two different CAD things
    // colliding on one unique index.
    const forged = buildElementExternalId({
      documentId: "d1",
      elementId: "e4",
      partId: "e9:XX"
    });
    const genuine = buildElementExternalId({
      documentId: "d1",
      elementId: "e4:e9",
      partId: "XX"
    });
    expect(forged).not.toBe(genuine);
  });

  it("refuses to build an id without both document and element", () => {
    expect(() =>
      buildElementExternalId({ documentId: "", elementId: "e4" })
    ).toThrow();
    expect(() =>
      buildElementExternalId({ documentId: "d1", elementId: "" })
    ).toThrow();
  });
});

describe("parseElementExternalId", () => {
  it("round-trips a subassembly", () => {
    const ref = { documentId: "d1a2b3", elementId: "e4c5d6" };
    expect(parseElementExternalId(buildElementExternalId(ref))).toEqual({
      ...ref,
      partId: null
    });
  });

  it("round-trips a part", () => {
    const ref = { documentId: "d1a2b3", elementId: "e4c5d6", partId: "JHD" };
    expect(parseElementExternalId(buildElementExternalId(ref))).toEqual(ref);
  });

  it("round-trips a component that needed escaping", () => {
    const ref = { documentId: "d1", elementId: "e4", partId: "e9:XX" };
    expect(parseElementExternalId(buildElementExternalId(ref))).toEqual(ref);
  });

  it("returns null for empty, absent or single-component ids", () => {
    expect(parseElementExternalId(null)).toBeNull();
    expect(parseElementExternalId(undefined)).toBeNull();
    expect(parseElementExternalId("")).toBeNull();
    expect(parseElementExternalId("d1a2b3")).toBeNull();
  });

  it("returns null rather than throwing on an undecodable id", () => {
    // A bare "%" is not valid percent-encoding; decodeURIComponent throws.
    expect(parseElementExternalId("d1:%")).toBeNull();
  });

  it("returns null when a component is blank", () => {
    expect(parseElementExternalId(":e4c5d6")).toBeNull();
    expect(parseElementExternalId("d1a2b3:")).toBeNull();
  });

  it("tolerates extra components so a future configuration key is not fatal", () => {
    expect(parseElementExternalId("d1:e4:JHD:cfgAbc")).toEqual({
      documentId: "d1",
      elementId: "e4",
      partId: "JHD"
    });
  });
});

describe("isSameElementRef", () => {
  it("treats null and absent partId as the same subassembly", () => {
    expect(
      isSameElementRef(
        { documentId: "d1", elementId: "e4" },
        { documentId: "d1", elementId: "e4", partId: null }
      )
    ).toBe(true);
  });

  it("distinguishes two parts in the same part studio", () => {
    expect(
      isSameElementRef(
        { documentId: "d1", elementId: "e4", partId: "JHD" },
        { documentId: "d1", elementId: "e4", partId: "JUD" }
      )
    ).toBe(false);
  });

  it("distinguishes a part from the part studio that contains it", () => {
    expect(
      isSameElementRef(
        { documentId: "d1", elementId: "e4" },
        { documentId: "d1", elementId: "e4", partId: "JHD" }
      )
    ).toBe(false);
  });

  it("distinguishes the same element id in two documents", () => {
    expect(
      isSameElementRef(
        { documentId: "d1", elementId: "e4" },
        { documentId: "d2", elementId: "e4" }
      )
    ).toBe(false);
  });
});

// The metadata patch is how an in-flight BOM import becomes visible on the
// item. Two executions write it — the route that dispatches the job, and the
// job itself — so what the merge keeps and what it replaces is the contract
// between them.

describe("mergeElementMappingMetadata", () => {
  it("keeps the fields the patch does not name", () => {
    expect(
      mergeElementMappingMetadata(
        { partNumber: "RD-410", versionId: "v1", elementType: 1 },
        { lastSyncedAt: "2026-08-21T10:00:00.000Z" }
      )
    ).toEqual({
      partNumber: "RD-410",
      versionId: "v1",
      elementType: 1,
      lastSyncedAt: "2026-08-21T10:00:00.000Z"
    });
  });

  it("overwrites a field the patch does name", () => {
    expect(
      mergeElementMappingMetadata({ versionId: "v1" }, { versionId: "v2" })
        .versionId
    ).toBe("v2");
  });

  it("treats an absent row's metadata as empty", () => {
    expect(
      mergeElementMappingMetadata(null, {
        progress: { startedAt: "2026-08-21T10:00:00.000Z" }
      })
    ).toEqual({ progress: { startedAt: "2026-08-21T10:00:00.000Z" } });
  });

  it("MERGES progress rather than replacing it", () => {
    // The job stamps the finish from a separate execution and has no reason to
    // re-supply the start time. Replacing would leave an import that finished
    // without ever having started.
    expect(
      mergeElementMappingMetadata(
        { progress: { startedAt: "2026-08-21T10:00:00.000Z" } },
        {
          progress: {
            finishedAt: "2026-08-21T10:02:00.000Z",
            attentionCount: 2
          }
        }
      ).progress
    ).toEqual({
      startedAt: "2026-08-21T10:00:00.000Z",
      finishedAt: "2026-08-21T10:02:00.000Z",
      attentionCount: 2
    });
  });

  it("REPLACES the marker when the patch names a new start", () => {
    // Re-dispatching stamps a NEW startedAt; the stale finishedAt must go with
    // it or the badge reads the old run's outcome as this one's.
    expect(
      mergeElementMappingMetadata(
        {
          progress: {
            startedAt: "2026-08-21T10:00:00.000Z",
            finishedAt: "2026-08-21T10:02:00.000Z",
            attentionCount: 2
          }
        },
        { progress: { startedAt: "2026-08-21T11:00:00.000Z" } }
      ).progress
    ).toEqual({ startedAt: "2026-08-21T11:00:00.000Z" });
  });

  it("drops a finish stamp with no marker to attach it to", () => {
    // An import that finished without ever having started is not a state the
    // badge can read, so it is not written.
    expect(
      mergeElementMappingMetadata(
        { partNumber: "RD-410" },
        { progress: { finishedAt: "2026-08-21T10:02:00.000Z" } }
      )
    ).toEqual({ partNumber: "RD-410" });
  });

  it("leaves an existing marker alone when the patch does not name one", () => {
    expect(
      mergeElementMappingMetadata(
        { progress: { startedAt: "2026-08-21T10:00:00.000Z" } },
        { versionId: "v2" }
      )
    ).toEqual({
      versionId: "v2",
      progress: { startedAt: "2026-08-21T10:00:00.000Z" }
    });
  });

  it("does not mutate the metadata it was given", () => {
    const current = { progress: { startedAt: "2026-08-21T10:00:00.000Z" } };
    mergeElementMappingMetadata(current, {
      progress: { finishedAt: "2026-08-21T10:02:00.000Z" }
    });
    expect(current.progress).toEqual({
      startedAt: "2026-08-21T10:00:00.000Z"
    });
  });
});
