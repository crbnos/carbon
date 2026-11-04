// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  matchingSearchLines,
  type SearchLine,
  searchMatches,
  searchTerms,
  withSearchLines
} from "./search";

// The list search matches the normalized values (`search_normalize`) and highlights with
// the same rule, so what matched is what is marked.
describe("searchTerms", () => {
  it("ignores case, spaces and punctuation inside a word", () => {
    expect(searchTerms("BRK-514")).toEqual(["brk514"]);
    expect(searchTerms("  Orbital   P-0000042.01 ")).toEqual([
      "orbital",
      "p000004201"
    ]);
  });

  it("drops words that are only punctuation", () => {
    expect(searchTerms("- / .")).toEqual([]);
    expect(searchTerms(null)).toEqual([]);
  });
});

describe("searchMatches", () => {
  it("marks the original characters a normalized term matched", () => {
    expect(searchMatches("BRK-514", ["brk514"])).toEqual([[0, 7]]);
    expect(searchMatches("TI  -200", ["ti200"])).toEqual([[0, 8]]);
  });

  it("merges overlapping matches of several terms", () => {
    expect(searchMatches("BEARING, 7000", ["bear", "ring", "7000"])).toEqual([
      [0, 7],
      [9, 13]
    ]);
  });

  it("marks nothing without a match", () => {
    expect(searchMatches("VLV708", ["7000"])).toEqual([]);
  });
});

// The list loads lines only for a search on screen; an open row loads its own.
describe("withSearchLines", () => {
  it("adds searchLines only for a search on the table on screen", () => {
    expect(withSearchLines("*", { forScreen: true, search: null })).toBe("*");
    expect(withSearchLines("*", { forScreen: true, search: " - / " })).toBe(
      "*"
    );
    expect(withSearchLines("*", { search: "brk" })).toBe("*");
    expect(withSearchLines("id,name", { forScreen: true, search: "brk" })).toBe(
      "id,name,searchLines"
    );
  });
});

const line = (overrides: Partial<SearchLine>): SearchLine => ({
  id: "line",
  itemReadableId: null,
  itemName: null,
  description: null,
  partNumber: null,
  quantity: 1,
  unitOfMeasureCode: "EA",
  ...overrides
});

describe("matchingSearchLines", () => {
  it("keeps the lines where any word matches a value, punctuation ignored", () => {
    const row = {
      searchLines: [
        line({ id: "a", partNumber: "BRK-514" }),
        line({ id: "b", itemName: "Bearing" }),
        line({ id: "c", description: "Spacer" })
      ]
    };
    expect(
      matchingSearchLines(row, ["brk514", "bear"]).map((match) => match.id)
    ).toEqual(["a", "b"]);
  });

  it("matches nothing without words or without lines", () => {
    const row = { searchLines: [line({ itemName: "Bearing" })] };
    expect(matchingSearchLines(row, [])).toEqual([]);
    expect(matchingSearchLines({ id: "po" }, ["bear"])).toEqual([]);
  });
});
