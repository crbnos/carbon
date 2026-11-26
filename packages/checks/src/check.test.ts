// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { defineCheck } from "./check";
import { openRepo } from "./repo";

describe("defineCheck with rule()", () => {
  it("builds a file rule on its first use, once", () => {
    let builds = 0;
    const check = defineCheck({
      id: "no-x",
      description: "",
      files: () => [{ file: "a.ts", contents: "x" }],
      rule() {
        builds++;
        return (file, contents) =>
          contents.includes("x")
            ? [{ file, line: 1, snippet: "x", message: "" }]
            : [];
      }
    });
    expect(builds).toBe(0);
    expect(check.scan("b.ts", "x").map((v) => v.file)).toEqual(["b.ts"]);
    expect(check.run(openRepo("/repo")).map((v) => v.file)).toEqual(["a.ts"]);
    expect(builds).toBe(1);
  });

  it("builds an inputs rule on its first use, once, with its inputs typed", () => {
    let builds = 0;
    const check = defineCheck({
      id: "no-long-word",
      description: "",
      reads: { words: () => ["ab", "abcd"], limit: () => 3 },
      rule() {
        builds++;
        return ({ words, limit }) =>
          words
            .filter((word) => word.length > limit)
            .map((word) => ({ file: "", line: 0, snippet: word, message: "" }));
      }
    });
    expect(builds).toBe(0);
    expect(check.run(openRepo("/repo")).map((v) => v.snippet)).toEqual([
      "abcd"
    ]);
    expect(
      check.find({ words: ["abc"], limit: 2 }).map((v) => v.snippet)
    ).toEqual(["abc"]);
    expect(builds).toBe(1);
  });
});

describe("defineCheck with bans", () => {
  it("finds what its banned data says, in the files it names", () => {
    const check = defineCheck({
      id: "no-x",
      description: "",
      files: () => [
        { file: "a.ts", contents: "x\ny x" },
        { file: "skip.ts", contents: "x" }
      ],
      within: "line",
      snippet: "match",
      except: ["skip.ts"],
      banned: [{ pattern: /x/g, message: "no x" }]
    });
    expect(check.run(openRepo("/repo"))).toEqual([
      { file: "a.ts", line: 1, snippet: "x", message: "no x" },
      { file: "a.ts", line: 2, snippet: "x", message: "no x" }
    ]);
    expect(check.scan("b.ts", "x").map((v) => v.file)).toEqual(["b.ts"]);
  });

  it("computes bans() on its first use, once", () => {
    let builds = 0;
    const check = defineCheck({
      id: "no-x",
      description: "",
      files: () => [{ file: "a.ts", contents: "x" }],
      bans() {
        builds++;
        return {
          within: "file",
          snippet: "match",
          banned: [{ pattern: new RegExp("x", "g"), message: "no x" }]
        };
      }
    });
    expect(builds).toBe(0);
    expect(check.scan("b.ts", "x").map((v) => v.file)).toEqual(["b.ts"]);
    expect(check.run(openRepo("/repo")).map((v) => v.file)).toEqual(["a.ts"]);
    expect(builds).toBe(1);
  });
});
