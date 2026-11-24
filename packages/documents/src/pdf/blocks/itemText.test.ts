// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { breakLongItemWord } from "./itemText";

describe("breakLongItemWord", () => {
  it("keeps a part number that fits the title column whole", () => {
    expect(breakLongItemWord("BAT-LIION-48V")).toEqual(["BAT-LIION-48V"]);
    expect(breakLongItemWord("x".repeat(16))).toEqual(["x".repeat(16)]);
  });

  it("breaks a longer part number after its own separators, with no hyphen drawn", () => {
    expect(breakLongItemWord("SW-1045-50R-EXTRA-LONG")).toEqual([
      "SW-",
      "",
      "1045-",
      "",
      "50R-",
      "",
      "EXTRA-",
      "",
      "LONG"
    ]);
  });

  it("breaks a run with no separator every 16 characters", () => {
    const run = "A".repeat(20);
    expect(breakLongItemWord(`${run}-B`)).toEqual([
      "A".repeat(16),
      "AAAA-",
      "",
      "B"
    ]);
  });

  it("rebuilds the word from its pieces", () => {
    const word = "PTS/8840_R2.LONGER-THAN-SIXTEEN";
    expect(breakLongItemWord(word).join("")).toBe(word);
  });
});
