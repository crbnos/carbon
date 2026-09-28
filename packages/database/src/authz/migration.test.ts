import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
      h.name === "get_companies_with_employee_role"
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
    expect(result.helpers).toContain("get_companies_with_employee_role");
  });

  test("a generated migration ships its tables and helpers", async () => {
    const helpers = (await loadHelpers()).map((h) =>
      h.name === "get_companies_with_employee_role"
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
      helpers.filter((h) => h.name === "get_companies_with_employee_role"),
      ["note", "tableView"]
    );
    // Every real generated migration (20260927172338 ships tableView as a company rule
    // first), then the edit: the later file must win.
    const generated = Object.fromEntries(
      readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .map(
          (f) =>
            [f, readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")] as const
        )
        .filter(([, sql]) => sql.startsWith(GENERATED_HEADER))
    );
    const dir = migrations({ ...generated, "20270101000001_ship.sql": sql });
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

  test("a retired helper is accepted only in the migration that last shipped it", async () => {
    const securityFixes = "20260927172338_authz-security-fixes.sql";
    const dir = migrations({
      [securityFixes]: readFileSync(
        path.join(MIGRATIONS_DIR, securityFixes),
        "utf8"
      ),
      "20270101000001_revive.sql": `${GENERATED_HEADER}\nCREATE OR REPLACE FUNCTION public.has_company_permission(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;\n`
    });
    const { problems } = await unshipped(manifest, await loadHelpers(), dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^20270101000001_revive\.sql: .*has_company_permission/
    );
  });
});
