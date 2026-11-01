// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { drawingKeysOf, drawingSourceKey } from "./onshape-drawing-source";

vi.mock("@carbon/ee/onshape", () => ({ selectInBatches: vi.fn() }));

describe("drawingSourceKey", () => {
  const base = {
    drawingElementId: "drw",
    drawingState: "mv-drawing-1",
    targetState: "mv-part-1"
  };

  it("names the same drawing and part state the same way", () => {
    expect(drawingSourceKey(base)).toBe(drawingSourceKey({ ...base }));
  });

  it("changes when the drawing or the part it shows changes", () => {
    const key = drawingSourceKey(base);
    expect(
      drawingSourceKey({ ...base, drawingState: "mv-drawing-2" })
    ).not.toBe(key);
    expect(drawingSourceKey({ ...base, targetState: "mv-part-2" })).not.toBe(
      key
    );
    expect(drawingSourceKey({ ...base, drawingElementId: "drw-2" })).not.toBe(
      key
    );
  });

  it("has no key when either state is unknown, so the drawing always exports", () => {
    expect(drawingSourceKey({ ...base, drawingState: null })).toBeNull();
    expect(drawingSourceKey({ ...base, targetState: undefined })).toBeNull();
  });
});

describe("drawingKeysOf", () => {
  it("reads the recorded key per drawing and ignores anything else", () => {
    expect(
      drawingKeysOf({ drawings: { a: "key-a", b: 3 }, other: true })
    ).toEqual({ a: "key-a" });
    expect(drawingKeysOf(null)).toEqual({});
    expect(drawingKeysOf({ drawings: ["a"] })).toEqual({});
  });
});
