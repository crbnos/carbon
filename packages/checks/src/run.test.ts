// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { defineCheck } from "./check";
import { CHECKS } from "./checks";
import { openRepo } from "./repo";
import { findOnWorkers, newViolations, runChecks } from "./run";
import { repoRoot } from "./sources/migrations";

describe("runChecks", () => {
  const words = () => ["red", "red blue", "green"];
  const flags = (id: string, word: string) =>
    defineCheck({
      id,
      description: "",
      reads: { words },
      rule: () => (inputs) =>
        inputs.words.flatMap((text, index) =>
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
    const reader = (id: string) =>
      defineCheck({
        id,
        description: "",
        reads: { input },
        rule: () => () => []
      });
    runChecks([reader("a"), reader("b")], openRepo("/repo"));
    expect(reads).toBe(1);
  });
});

describe("findOnWorkers", () => {
  it(
    "finds on worker threads exactly what runChecks finds",
    {
      timeout: 60_000
    },
    async () => {
      const cheap = [
        "module-shape",
        "form-field-budget",
        "test-mocks-own-module"
      ];
      const checks = CHECKS.filter((check) => cheap.includes(check.id));
      const ids = checks.map((check) => check.id);
      const expected = runChecks(checks, openRepo(repoRoot()));
      expect(expected.length).toBeGreaterThan(0);
      expect(await findOnWorkers(ids, repoRoot(), 2)).toEqual(expected);
    }
  );

  it(
    "rejects with the id of a check that throws",
    {
      timeout: 60_000
    },
    async () => {
      // Its loader runs `git ls-files` in the root, which does not exist.
      await expect(
        findOnWorkers(["test-mocks-own-module"], "/no/such/checkout", 1)
      ).rejects.toThrow(/^Check test-mocks-own-module threw: .*ENOENT/);
    }
  );
});

describe("conformance gate (real migrations vs baseline)", () => {
  // Whole-repo filesystem scan (migrations + both apps' route trees): ~3s alone,
  // but 20-38s inside CI's `pnpm test`, where it shares the runner's CPU with
  // every other package's suite.
  it(
    "introduces no NEW deprecated patterns beyond the committed baseline",
    {
      timeout: 120_000
    },
    async () => {
      const fresh = await newViolations();
      const detail = fresh
        .map(
          (f) =>
            `  ${f.checkId}  ${f.violation.file}:${f.violation.line}  ${f.violation.snippet}\n    ${f.violation.message}`
        )
        .join("\n");
      expect(fresh, `New conformance violations:\n${detail}`).toHaveLength(0);
    }
  );
});
