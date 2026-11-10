// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { clampScrollTop } from "./useInfiniteScroll";
import { getVirtualSlots, withKeptIndex } from "./useVirtualRows";

describe("withKeptIndex", () => {
  it("adds the kept index in order when it is out of view", () => {
    expect(withKeptIndex([5, 6, 7], 1, 10)).toEqual([1, 5, 6, 7]);
    expect(withKeptIndex([5, 6, 7], 9, 10)).toEqual([5, 6, 7, 9]);
  });

  it("changes nothing for an index in view, out of range or unset", () => {
    const indexes = [5, 6, 7];
    expect(withKeptIndex(indexes, 6, 10)).toBe(indexes);
    expect(withKeptIndex(indexes, 12, 10)).toBe(indexes);
    expect(withKeptIndex(indexes, undefined, 10)).toBe(indexes);
  });
});

describe("getVirtualSlots", () => {
  it("puts a spacer before, between and after the rendered items", () => {
    // Items of 10px start at the 40px margin (a header).
    const item = (index: number) => ({
      index,
      start: 40 + index * 10,
      end: 50 + index * 10
    });
    expect(getVirtualSlots([item(2), item(3), item(6)], 100, 40)).toEqual([
      { kind: "spacer", key: "before-2", height: 20 },
      { kind: "item", index: 2 },
      { kind: "item", index: 3 },
      { kind: "spacer", key: "before-6", height: 20 },
      { kind: "item", index: 6 },
      { kind: "spacer", key: "after", height: 30 }
    ]);
  });

  it("is one spacer when nothing is rendered", () => {
    expect(getVirtualSlots([], 50, 0)).toEqual([
      { kind: "spacer", key: "after", height: 50 }
    ]);
  });
});

describe("clampScrollTop", () => {
  it("stops a restored offset at the end of the content", () => {
    const element = { scrollHeight: 2000, clientHeight: 500 };
    expect(clampScrollTop(800, element)).toBe(800);
    expect(clampScrollTop(9000, element)).toBe(1500);
    expect(clampScrollTop(-5, element)).toBe(0);
    expect(clampScrollTop(100, { scrollHeight: 300, clientHeight: 500 })).toBe(
      0
    );
  });
});
