// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { blankComments, maskCommentsAndStrings } from "./comments";

// Each row: the source, then what blankComments and maskCommentsAndStrings
// return. Every output keeps the length and the newlines of its source.
const CASES: [source: string, blanked: string, masked: string][] = [
  ["a // b\nc", "a     \nc", "a     \nc"],
  ["x /* y\n z */ w", "x     \n      w", "x     \n      w"],
  // blankComments searches for `*/` from the opening slash, so `/*/` closes
  // itself there; maskCommentsAndStrings searches after the `/*`.
  ["/*/ x */ y", "    x */ y", "         y"],
  ['"// kept" // gone', '"// kept"        ', '"       "        '],
  ["'a\\'b' /* c */", "'a\\'b'        ", "'    '        "],
  ["x /* open\nend", "x        \n   ", "x        \n   "],
  ["a\r\n// b\r\nc", "a\r\n     \nc", "a\r\n     \nc"]
];

describe("blankComments", () => {
  it.each(CASES)("blanks the comments of %j", (source, blanked) => {
    expect(blankComments(source)).toBe(blanked);
  });
});

describe("maskCommentsAndStrings", () => {
  it.each(CASES)(
    "blanks the comments and string interiors of %j",
    (source, _blanked, masked) => {
      expect(maskCommentsAndStrings(source)).toBe(masked);
    }
  );
});
