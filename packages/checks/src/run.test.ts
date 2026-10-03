// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { newViolations, scanAll } from "./run";

describe("scanAll", () => {
  it("returns every (checkId, violation) across files and checks", () => {
    const files = [
      { file: "a.sql", contents: "x NUMERIC(10,2)" },
      { file: "b.sql", contents: "USING (has_company_permission('view'))" },
      { file: "c.sql", contents: "y NUMERIC" }
    ];
    const found = scanAll(files);
    const ids = found.map((f) => f.checkId).sort();
    expect(ids).toEqual(["no-legacy-rls", "no-numeric-precision"]);
    expect(found.every((f) => typeof f.violation.line === "number")).toBe(true);
  });
});

describe("conformance gate (real migrations vs baseline)", () => {
  // Whole-repo filesystem scan (migrations + both apps' route trees): ~3s alone,
  // but 20-38s inside CI's `pnpm test`, where it shares the runner's CPU with
  // every other package's suite.
  it(
    "introduces no NEW deprecated patterns beyond the committed baseline",
    { timeout: 120_000 },
    () => {
      const fresh = newViolations();
      const detail = fresh
        .map(
          (f) =>
            `  ${f.checkId}  ${f.violation.file}:${f.violation.line}  ${f.violation.snippet}`
        )
        .join("\n");
      expect(fresh, `New conformance violations:\n${detail}`).toHaveLength(0);
    }
  );
});
