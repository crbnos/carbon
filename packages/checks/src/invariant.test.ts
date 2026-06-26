import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadInvariants, runInvariants } from "./invariant";
import { repoRoot } from "./sources/migrations";

describe("loadInvariants", () => {
  it("loads each .sql file as an invariant keyed by basename (no extension)", () => {
    const dir = mkdtempSync(join(tmpdir(), "inv-"));
    writeFileSync(join(dir, "b-rule.sql"), "SELECT 2;");
    writeFileSync(join(dir, "a-rule.sql"), "SELECT 1;");
    writeFileSync(join(dir, "notes.txt"), "ignore");
    const inv = loadInvariants(dir);
    expect(inv.map((i) => i.id)).toEqual(["a-rule", "b-rule"]);
    expect(inv[0]?.sql).toBe("SELECT 1;");
  });
});

describe("runInvariants", () => {
  it("passes when the query returns no rows, fails when it returns violating rows", async () => {
    const invariants = [
      { id: "ok", sql: "SELECT 1 WHERE false" },
      { id: "bad", sql: "SELECT id FROM t" }
    ];
    const query = async (sql: string) =>
      sql.includes("FROM t") ? [{ id: "x" }, { id: "y" }] : [];
    const results = await runInvariants(invariants, query);
    expect(results).toEqual([
      { id: "ok", passed: true, violatingRows: [] },
      { id: "bad", passed: false, violatingRows: [{ id: "x" }, { id: "y" }] }
    ]);
  });

  it("captures a query error as a failed result without throwing", async () => {
    const query = async () => {
      throw new Error("boom");
    };
    const [r] = await runInvariants([{ id: "e", sql: "SELECT bad" }], query);
    expect(r?.passed).toBe(false);
    expect(r?.error).toContain("boom");
  });
});

describe("seed invariants", () => {
  it("loads the committed invariants directory", () => {
    const dir = `${repoRoot()}/packages/checks/src/invariants`;
    const inv = loadInvariants(dir);
    expect(inv.length).toBeGreaterThanOrEqual(1);
    expect(inv.some((i) => i.id === "tracked-entity-readable-id")).toBe(true);
  });
});
