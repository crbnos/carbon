// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  countOccurrences,
  matchesPath,
  matchingTriggers,
  parseFrontmatter,
  readScope
} from "./scope";

describe("matchesPath", () => {
  it("matches a file under a ** glob", () => {
    expect(
      matchesPath("apps/erp/app/routes/x+/a.tsx", ["apps/erp/app/routes/**"])
    ).toBe(true);
  });

  it("does not match a file outside every glob", () => {
    expect(matchesPath("apps/mes/a.ts", ["apps/erp/**"])).toBe(false);
  });
});

describe("matchingTriggers", () => {
  const twoWrites = { text: ".update(", minCount: 2 };

  it("selects a minCount trigger when the text occurs that often", () => {
    expect(matchingTriggers("a.update(x); b.update(y)", [twoWrites])).toEqual([
      twoWrites
    ]);
  });

  it("skips a minCount trigger when the text occurs fewer times", () => {
    expect(matchingTriggers("a.update(x)", [twoWrites])).toEqual([]);
  });

  it("is case-sensitive, since triggers are code tokens", () => {
    expect(matchingTriggers("CTX.TRANSACTION", ["ctx.transaction"])).toEqual(
      []
    );
  });

  it("counts occurrences without overlap", () => {
    expect(countOccurrences("aaaa", "aa")).toBe(2);
  });
});

describe("parseFrontmatter", () => {
  it("returns the mapping and the body after the closing line", () => {
    expect(
      parseFrontmatter("---\npaths:\n  - a/**\n---\n# Title\n\nText\n")
    ).toEqual({ data: { paths: ["a/**"] }, body: "# Title\n\nText\n" });
  });

  it("returns the whole text as the body when there is no frontmatter", () => {
    expect(parseFrontmatter("# Title\n")).toEqual({
      data: {},
      body: "# Title\n"
    });
  });

  it("throws on frontmatter that does not parse", () => {
    expect(() => parseFrontmatter("---\npaths: [\n---\n")).toThrow();
  });
});

describe("readScope", () => {
  it("reads paths and both trigger forms", () => {
    expect(
      readScope({
        paths: ["a/**"],
        triggers: ["ctx.transaction", { text: ".insert(", minCount: 2 }]
      })
    ).toEqual({
      paths: ["a/**"],
      triggers: ["ctx.transaction", { text: ".insert(", minCount: 2 }]
    });
  });

  it("reads a missing scope as empty lists", () => {
    expect(readScope({})).toEqual({ paths: [], triggers: [] });
  });

  it("refuses a trigger object without an integer minCount", () => {
    expect(() =>
      readScope({ triggers: [{ text: ".insert(", minCount: "2" }] })
    ).toThrow();
  });
});
