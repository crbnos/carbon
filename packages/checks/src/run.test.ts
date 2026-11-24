// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ConformanceCheck } from "./check";
import { newViolations, scanAll } from "./run";

describe("scanAll", () => {
  it("runs every check over every file and names the check of each violation", () => {
    const flags = (id: string, word: string): ConformanceCheck => ({
      id,
      description: "",
      provenance: { deprecates: "", replacedBy: "" },
      scan: (file, contents) =>
        contents.includes(word)
          ? [{ file, line: 1, snippet: word, message: "" }]
          : []
    });
    const files = [
      { file: "a.sql", contents: "red" },
      { file: "b.sql", contents: "red blue" },
      { file: "c.sql", contents: "green" }
    ];
    const found = scanAll(files, [
      flags("no-red", "red"),
      flags("no-blue", "blue")
    ]);
    expect(found.map((f) => [f.checkId, f.violation.file])).toEqual([
      ["no-red", "a.sql"],
      ["no-red", "b.sql"],
      ["no-blue", "b.sql"]
    ]);
  });
});

describe("conformance gate (real migrations vs baseline)", () => {
  // Whole-repo filesystem scan (migrations + both apps' route trees): ~3s alone,
  // but 20-38s inside CI's `pnpm test`, where it shares the runner's CPU with
  // every other package's suite.
  it("introduces no NEW deprecated patterns beyond the committed baseline", {
    timeout: 120_000
  }, async () => {
    const fresh = await newViolations();
    const detail = fresh
      .map(
        (f) =>
          `  ${f.checkId}  ${f.violation.file}:${f.violation.line}  ${f.violation.snippet}\n    ${f.violation.message}`
      )
      .join("\n");
    expect(fresh, `New conformance violations:\n${detail}`).toHaveLength(0);
  });
});
