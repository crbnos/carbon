// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { testReadsSource } from "./test-reads-source";

const lines = (contents: string) =>
  testReadsSource.scan("x.test.ts", contents).map((v) => v.line);

describe("testReadsSource", () => {
  it.each([
    [
      "a migration read by literal path",
      `const sql = readFileSync("../supabase/migrations/2026_x.sql", "utf8");`
    ],
    [
      "a source file through a URL",
      `const s = readFileSync(new URL("../utils/a.ts", import.meta.url), "utf8");`
    ],
    [
      "a path held in a constant",
      `const MIGRATION = join(__dirname, "../x.sql");
const sql = readFileSync(MIGRATION, "utf8");`
    ],
    [
      "a file from a loop over a migrations directory",
      `const DIR = new URL("../migrations/", import.meta.url);
for (const name of readdirSync(DIR)) {
  readFileSync(new URL(name, DIR), "utf8");
}`
    ],
    [
      "a read helper called with a source path",
      `const read = (p: string) => readFileSync(new URL(p, root), "utf8");
read("sst.config.ts");`
    ],
    [
      "a walk filtered to source extensions",
      `const exts = new Set([".ts", ".tsx"]);
files.filter((f) => /bad/.test(readFileSync(f, "utf8")));`
    ],
    ["a ?raw import of SQL", `import sql from "./fn.sql?raw";`],
    [
      "an import.meta.glob of source as raw text",
      `const all = import.meta.glob("./**/*.ts", { query: "?raw" });`
    ]
  ])("flags %s", (_, contents) => {
    expect(lines(contents).length).toBeGreaterThan(0);
  });

  it.each([
    [
      "a JSON fixture",
      `const data = JSON.parse(readFileSync(join(__dirname, "fixture.json"), "utf8"));`
    ],
    [
      "a binary fixture",
      `const pdf = () => readFile(join(__dirname, "__fixtures__", "sample.pdf"));`
    ],
    [
      "a file the test wrote to a temp dir",
      `const dir = mkdtempSync(join(tmpdir(), "x-"));
writeFileSync(join(dir, "types.ts"), "x");
expect(readFileSync(join(dir, "types.ts"), "utf8")).toBe("x");`
    ],
    [
      "a module imported as code",
      `const modules = import.meta.glob("../app/modules/*/*.service.ts");`
    ],
    [
      "a directory listing that is not the migrations",
      `const names = readdirSync(join(ROOT, "packages"));`
    ]
  ])("accepts %s", (_, contents) => {
    expect(lines(contents)).toEqual([]);
  });

  it("reports the line of the read", () => {
    expect(
      lines(`import { readFileSync } from "node:fs";

const sql = readFileSync("./a.sql", "utf8");`)
    ).toEqual([3]);
  });
});
