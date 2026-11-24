// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  formatPartNumber,
  PART_NUMBER_DISPLAYS,
  resolvePartNumberDisplay,
  summarizePartNumberDisplay
} from "./part-number";

const both = { ours: "P000123.B", theirs: "C-100", theirsRevision: "3" };

describe("formatPartNumber", () => {
  it.each([
    ["Ours First", "P000123.B (C-100 Rev 3)"],
    ["Theirs First", "C-100 Rev 3 (P000123.B)"],
    ["Theirs Only", "C-100 Rev 3"],
    ["Ours Only", "P000123.B"]
  ] as const)("prints %s", (display, expected) => {
    expect(formatPartNumber(both, display)).toBe(expected);
  });

  it("prints no space before the bracket when theirs has no revision", () => {
    expect(
      formatPartNumber({ ours: "P000123.B", theirs: "C-200" }, "Ours First")
    ).toBe("P000123.B (C-200)");
  });

  it("prints ours whatever the choice when theirs is blank", () => {
    for (const display of PART_NUMBER_DISPLAYS) {
      expect(
        formatPartNumber({ ours: "P000123.B", theirs: "  " }, display)
      ).toBe("P000123.B");
    }
  });

  it("prints one number when theirs repeats ours", () => {
    expect(
      formatPartNumber({ ours: "P000123.B", theirs: "P000123.B" }, "Ours First")
    ).toBe("P000123.B");
  });

  it("prints theirs when there is no number of ours", () => {
    expect(
      formatPartNumber({ ours: null, theirs: "C-100" }, "Ours First")
    ).toBe("C-100");
  });
});

describe("resolvePartNumberDisplay", () => {
  it("gives a legacy line its surface's old output", () => {
    expect(resolvePartNumberDisplay("sharedQuote", null)).toBe("Ours Only");
    expect(resolvePartNumberDisplay("purchaseOrderEmail", null)).toBe(
      "Ours First"
    );
  });

  it("keeps a stored choice", () => {
    expect(resolvePartNumberDisplay("quote", "Theirs Only")).toBe(
      "Theirs Only"
    );
  });
});

describe("summarizePartNumberDisplay", () => {
  it.each([
    [[], null],
    [[null, null], null],
    [["Ours First", "Ours First"], "Ours First"],
    [["Ours First", null], "mixed"],
    [["Ours First", "Theirs Only"], "mixed"]
  ] as const)("summarizes %j as %s", (values, expected) => {
    expect(summarizePartNumberDisplay(values)).toBe(expected);
  });
});
