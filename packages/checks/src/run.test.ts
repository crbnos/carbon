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
  it("introduces no NEW deprecated patterns beyond the committed baseline", () => {
    const fresh = newViolations();
    const detail = fresh
      .map(
        (f) =>
          `  ${f.checkId}  ${f.violation.file}:${f.violation.line}  ${f.violation.snippet}`
      )
      .join("\n");
    expect(fresh, `New conformance violations:\n${detail}`).toHaveLength(0);
  });
});
