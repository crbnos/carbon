// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { Check } from "./check";
import { openRepo } from "./repo";
import { newViolations, runChecks } from "./run";

describe("runChecks", () => {
  const words = () => ["red", "red blue", "green"];
  const flags = (id: string, word: string): Check => ({
    id,
    description: "",
    find: (repo) =>
      repo
        .read(words)
        .flatMap((text, index) =>
          text.includes(word)
            ? [{ file: `${index}.sql`, line: 1, snippet: word, message: "" }]
            : []
        )
  });

  it("gives every violation of every check, under that check's id", () => {
    const found = runChecks(
      [flags("no-red", "red"), flags("no-blue", "blue")],
      openRepo("/repo")
    );
    expect(found.map((f) => [f.checkId, f.violation.file])).toEqual([
      ["no-red", "0.sql"],
      ["no-red", "1.sql"],
      ["no-blue", "1.sql"]
    ]);
  });

  it("reads an input once however many checks ask for it", () => {
    let reads = 0;
    const input = (root: string) => {
      reads++;
      return [root];
    };
    const reader = (id: string): Check => ({
      id,
      description: "",
      find: (repo) => {
        repo.read(input);
        return [];
      }
    });
    runChecks([reader("a"), reader("b")], openRepo("/repo"));
    expect(reads).toBe(1);
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
