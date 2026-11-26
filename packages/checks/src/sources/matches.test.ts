// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { bannedHits, lineViolations, matchViolations } from "./matches";

describe("bannedHits", () => {
  it("gives every match of each pattern, pattern by pattern", () => {
    expect(
      bannedHits("b a b a", [
        { pattern: /a/g, message: "no a" },
        { pattern: /b/g, message: "no b" }
      ])
    ).toEqual([
      { snippet: "a", message: "no a" },
      { snippet: "a", message: "no a" },
      { snippet: "b", message: "no b" },
      { snippet: "b", message: "no b" }
    ]);
  });

  it("gives nothing for text no pattern matches", () => {
    expect(bannedHits("c", [{ pattern: /a/g, message: "no a" }])).toEqual([]);
  });
});

describe("lineViolations", () => {
  const eachLetter = (line: string) =>
    line.split("").map((c) => ({ snippet: c, message: line }));

  it("places each hit at its file and 1-based line, line by line", () => {
    expect(lineViolations("f.ts", "x\nyy\nx", /./, eachLetter)).toEqual([
      { file: "f.ts", line: 1, snippet: "x", message: "x" },
      { file: "f.ts", line: 2, snippet: "y", message: "yy" },
      { file: "f.ts", line: 2, snippet: "y", message: "yy" },
      { file: "f.ts", line: 3, snippet: "x", message: "x" }
    ]);
  });

  it("skips a line mayMatch does not match", () => {
    expect(lineViolations("f.ts", "x\nyy\nx", /y/, eachLetter)).toEqual([
      { file: "f.ts", line: 2, snippet: "y", message: "yy" },
      { file: "f.ts", line: 2, snippet: "y", message: "yy" }
    ]);
  });
});

describe("matchViolations", () => {
  it("places each match at the line it starts on", () => {
    expect(
      matchViolations("f.ts", "a\nb(\n)\nb()", /b\(\s*\)/g, (match) => ({
        snippet: match[0].replace(/\s+/g, " "),
        message: "no b()"
      }))
    ).toEqual([
      { file: "f.ts", line: 2, snippet: "b( )", message: "no b()" },
      { file: "f.ts", line: 4, snippet: "b()", message: "no b()" }
    ]);
  });

  it("gives nothing when the pattern does not match", () => {
    expect(
      matchViolations("f.ts", "a", /b/g, () => ({ snippet: "", message: "" }))
    ).toEqual([]);
  });
});
