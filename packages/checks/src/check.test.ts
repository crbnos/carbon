// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { checksOf, defineCheck } from "./check";
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

describe("checksOf", () => {
  it("lists a file's checks in the order they are defined, not by name", () => {
    const define = (id: string) =>
      defineCheck({ id, description: "", files: () => [], scan: () => [] });
    const zebra = define("zebra");
    const apple = define("apple");
    expect(checksOf({ apple, zebra }).map((check) => check.id)).toEqual([
      "zebra",
      "apple"
    ]);
  });
});
