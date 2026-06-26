import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSqlFiles } from "./migrations";

describe("loadSqlFiles", () => {
  it("loads .sql files sorted by name, ignoring non-sql", () => {
    const dir = mkdtempSync(join(tmpdir(), "core-"));
    writeFileSync(join(dir, "b.sql"), "SELECT 2;");
    writeFileSync(join(dir, "a.sql"), "SELECT 1;");
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    const files = loadSqlFiles(dir);
    expect(files.map((f) => f.file)).toEqual(["a.sql", "b.sql"]);
    expect(files[0]?.contents).toBe("SELECT 1;");
  });
});
