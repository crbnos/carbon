import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadHelpers } from "./helpers";
import { manifest } from "./manifest";
import {
  GENERATED_HEADER,
  MIGRATIONS_DIR,
  renderMigration,
  unshipped
} from "./migration";
import { company, type Manifest, serviceOnly } from "./rules";

// A migrations directory holding only the given generated files.
const migrations = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "authz-migrations-"));
  for (const [name, sql] of Object.entries(files))
    writeFileSync(path.join(dir, name), sql);
  return dir;
};

describe("unshipped: production gets every rule and helper through a migration", () => {
  test("the repository ships everything the manifest and helpers say", async () => {
    expect(
      await unshipped(manifest, await loadHelpers()),
      "Production would not get these. Run: pnpm --filter @carbon/database authz migration <name>"
    ).toEqual({
      tables: [],
      helpers: [],
      problems: []
    });
  });

  test("an edited rule, a new table and an edited helper are unshipped", async () => {
    const helpers = await loadHelpers();
    const edited = helpers.map((h) =>
      h.name === "has_role"
        ? { ...h, sql: h.sql.replace("STABLE", "VOLATILE") }
        : h
    );
    const result = await unshipped(
      {
        ...manifest,
        note: company("parts"),
        brandNewTable: company("parts")
      } as Manifest,
      edited,
      migrations({})
    );
    expect(result.tables).toEqual(
      expect.arrayContaining(["note", "brandNewTable"])
    );
    expect(result.helpers).toContain("has_role");
  });

  test("a generated migration ships its tables and helpers", async () => {
    const helpers = (await loadHelpers()).map((h) =>
      h.name === "has_role"
        ? { ...h, sql: h.sql.replace("STABLE", "VOLATILE") }
        : h
    );
    const edited = {
      ...manifest,
      note: company("parts"),
      tableView: serviceOnly()
    } as Manifest;
    const sql = await renderMigration(
      edited,
      helpers.filter((h) => h.name === "has_role"),
      ["note", "tableView"]
    );
    const dir = migrations({
      // Ships tableView as a company rule first; the later file must win.
      "20260101000001_security-fixes.sql": readFileSync(
        path.join(MIGRATIONS_DIR, "20260927172338_authz-security-fixes.sql"),
        "utf8"
      ),
      "20270101000001_ship.sql": sql
    });
    const result = await unshipped(edited, helpers, dir);
    expect(result).toEqual({ tables: [], helpers: [], problems: [] });
  });

  test("the header cannot carry anything `authz migration` does not write", async () => {
    const note = await renderMigration(manifest, [], ["note"]);
    const dir = migrations({
      "20270101000001_spoof.sql": `${note}\nGRANT ALL ON public.note TO anon;\n`,
      "20270101000002_spoof.sql": `${GENERATED_HEADER}\n${note
        .split("\n")
        .slice(1)
        .join("\n")
        .replace(/USING \(/, "USING (true OR ")}`
    });
    const result = await unshipped(manifest, await loadHelpers(), dir);
    expect(result.problems.join("\n")).toContain("GRANT ALL");
    expect(result.tables).toContain("note");
  });
});
