// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { rangeBetween } from "./rangeSelection";

const ids = ["a", "b", "c", "d", "e"];

describe("rangeBetween", () => {
  it("returns the ids from the anchor down to the clicked id", () => {
    expect(rangeBetween(ids, "b", "d")).toEqual(["b", "c", "d"]);
  });

  it("returns the same range when the click is above the anchor", () => {
    expect(rangeBetween(ids, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("returns only the row when the anchor is the clicked row", () => {
    expect(rangeBetween(ids, "c", "c")).toEqual(["c"]);
  });

  it("returns null with no anchor", () => {
    expect(rangeBetween(ids, null, "c")).toBeNull();
  });

  it("returns null when the anchor is no longer visible", () => {
    expect(rangeBetween(ids, "gone", "c")).toBeNull();
  });

  it("returns null when the clicked id is not in the list", () => {
    expect(rangeBetween(ids, "a", "gone")).toBeNull();
  });
});
