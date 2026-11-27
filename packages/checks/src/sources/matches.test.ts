// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type Bans, findBanned, matchViolations } from "./matches";

describe("findBanned", () => {
  const banned = [
    { pattern: /a\s+b/g, message: "no a b" },
    { pattern: /c/g, message: "no c" }
  ];

  it("within a file, places each match at the line it starts on, pattern by pattern", () => {
    expect(
      findBanned("f.ts", "c a\n  b\na b c", {
        within: "file",
        snippet: "match",
        banned
      })
    ).toEqual([
      { file: "f.ts", line: 1, snippet: "a\n  b", message: "no a b" },
      { file: "f.ts", line: 3, snippet: "a b", message: "no a b" },
      { file: "f.ts", line: 1, snippet: "c", message: "no c" },
      { file: "f.ts", line: 3, snippet: "c", message: "no c" }
    ]);
  });

  it("within a file, a trimmed-line snippet is the line each match starts on", () => {
    expect(
      findBanned("f.ts", "  x a\n  b y\n a b a b", {
        within: "file",
        snippet: "trimmed-line",
        banned: [{ pattern: /a\s+b/g, message: "no a b" }]
      })
    ).toEqual([
      { file: "f.ts", line: 1, snippet: "x a", message: "no a b" },
      { file: "f.ts", line: 3, snippet: "a b a b", message: "no a b" },
      { file: "f.ts", line: 3, snippet: "a b a b", message: "no a b" }
    ]);
  });

  it("collapses the whitespace of a collapsed-match snippet", () => {
    expect(
      findBanned("f.ts", "a\n  b", {
        within: "file",
        snippet: "collapsed-match",
        banned
      }).map((v) => v.snippet)
    ).toEqual(["a b"]);
  });

  it("within a line, finds no match that spans lines, line by line", () => {
    expect(
      findBanned("f.ts", "a\nb c a  b c", {
        within: "line",
        snippet: "match",
        banned
      })
    ).toEqual([
      { file: "f.ts", line: 2, snippet: "a  b", message: "no a b" },
      { file: "f.ts", line: 2, snippet: "c", message: "no c" },
      { file: "f.ts", line: 2, snippet: "c", message: "no c" }
    ]);
  });

  it("gives a trimmed-line snippet once per pattern a line matches", () => {
    expect(
      findBanned("f.ts", "  c c a b  \nx", {
        within: "line",
        snippet: "trimmed-line",
        banned
      })
    ).toEqual([
      { file: "f.ts", line: 1, snippet: "c c a b", message: "no a b" },
      { file: "f.ts", line: 1, snippet: "c c a b", message: "no c" }
    ]);
  });

  it("skips a file or line without mayContain, and an exempt file", () => {
    const bans: Bans = {
      within: "line",
      snippet: "match",
      banned,
      mayContain: /a/,
      except: ["skip.ts", /^gen\//]
    };
    expect(findBanned("f.ts", "c\na b c", bans).map((v) => v.line)).toEqual([
      2, 2
    ]);
    expect(findBanned("f.ts", "c", bans)).toEqual([]);
    expect(findBanned("skip.ts", "a b", bans)).toEqual([]);
    expect(findBanned("gen/f.ts", "a b", bans)).toEqual([]);
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
