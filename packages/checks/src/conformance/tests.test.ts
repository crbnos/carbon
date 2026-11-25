// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { repoRoot } from "../sources/migrations";
import {
  loadSharedTestFixtures,
  noSilentTestPass,
  sharedTestWrappers,
  testMocksOwnModule,
  testReadsSource
} from "./tests";

const scanMocks = (contents: string) =>
  testMocksOwnModule.scan("apps/erp/app/x.test.ts", contents);

describe("testMocksOwnModule", () => {
  it.each([
    ['vi.mock("./x.service")', 'vi.mock("./x.service")'],
    ["vi.mock('../../db', () => ({}))", 'vi.mock("../../db")'],
    ["vi.doMock(`~/modules/items`)", 'vi.doMock("~/modules/items")'],
    ['vi.mock(import("./client"), () => ({}))', 'vi.mock("./client")']
  ])("flags %s", (source, snippet) => {
    expect(scanMocks(source).map((v) => v.snippet)).toEqual([snippet]);
  });

  it("accepts mocks of packages and node built-ins", () => {
    expect(
      scanMocks(`vi.mock("@carbon/auth/client.server");
vi.mock("node:fs");
vi.mock("@lingui/core/macro", () => ({}));`)
    ).toEqual([]);
  });

  it("reports the line of each mock", () => {
    expect(
      scanMocks(`import { vi } from "vitest";
vi.mock("./a");

vi.mock("./b");`).map((v) => v.line)
    ).toEqual([2, 4]);
  });
});

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
      "a fixture whose name holds a bracket, in a file that names a source file",
      `const data = readFileSync(join(dir, "export (1.json"), "utf8");
expect(outputName(data)).toBe("types.ts");`
    ],
    [
      "that fixture's path held in a constant",
      `const FIXTURE = join(dir, "export (1.json");
const expected = "types.ts";
const data = readFileSync(FIXTURE, "utf8");`
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

const scanSilentPass = (contents: string) =>
  noSilentTestPass(["databaseTest", "postgrestTest"]).scan(
    "apps/erp/test/database/x.test.ts",
    contents
  );
const snippets = (contents: string) =>
  scanSilentPass(contents).map((v) => v.snippet);

describe("noSilentTestPass", () => {
  it("flags the cancel-job wrapper as it was on main", () => {
    const source = `const caller = hasLocalDatabase ? localServiceRoleClient() : null;
const cancelTest = (name: string, fn: () => Promise<void>) =>
  databaseTest(name, async () => {
    if (!caller) return;
    await fn();
  });

cancelTest("a Ready job is cancelled", async () => {
  expect(await cancel()).toEqual({ status: "Cancelled" });
});`;
    expect(scanSilentPass(source)).toEqual([
      {
        file: "apps/erp/test/database/x.test.ts",
        line: 4,
        snippet: "if (!caller) return;",
        message: expect.stringContaining("it.skipIf(!x)")
      }
    ]);
  });

  it("accepts the same wrapper once it skips", () => {
    expect(
      scanSilentPass(`const caller = hasLocalDatabase ? localServiceRoleClient() : null;
const cancelTest = (name: string, fn: () => Promise<void>) =>
  it.skipIf(!caller)(name, fn, 60_000);

cancelTest("a Ready job is cancelled", async () => {
  expect(await cancel()).toEqual({ status: "Cancelled" });
});`)
    ).toEqual([]);
  });

  it.each([
    ['it("a", async () => {\n  if (!client) return;\n  run();\n});'],
    ['test("a", () => {\n  if (!client) return;\n});'],
    ['it.only("a", async () => {\n  if (!client) return;\n});'],
    ['it.concurrent("a", async () => {\n  if (!client) return;\n});'],
    ['it.each([1, 2])("a %i", async (n) => {\n  if (!client) return;\n});'],
    ['it.skipIf(!db)("a", async () => {\n  if (!client) return;\n});'],
    [
      'it("a", { timeout: 9 }, async function () {\n  if (!client) return;\n});'
    ],
    ['databaseTest("a", async () => {\n  if (!client) return;\n});'],
    ['postgrestTest("a", async (client) => {\n  if (!client) return;\n});']
  ])("flags an early return in %s", (source) => {
    expect(snippets(source)).toEqual(["if (!client) return;"]);
  });

  it.each([
    ["if (!client) { return; }", "if (!client) { return; }"],
    ["if (client == null) return;", "if (client == null) return;"],
    ["if (client === undefined) return;", "if (client === undefined) return;"],
    ["if (!client || !db) return;", "if (!client || !db) return;"],
    ["if (rows.length === 0) return;", "if (rows.length === 0) return;"],
    ["if (!client) return\n  run();", "if (!client) return"]
  ])("flags the guard %s", (guard, snippet) => {
    expect(snippets(`it("a", async () => {\n  ${guard}\n});`)).toEqual([
      snippet
    ]);
  });

  it("flags a guard in the try block that releases the connection", () => {
    expect(
      scanSilentPass(`databaseTest("a", async () => {
  const db = await connect();
  try {
    const owner = await db.selectFrom("user").executeTakeFirst();
    if (!owner) return;
    expect(owner.id).toBe("x");
  } finally {
    await db.destroy();
  }
});`).map((v) => v.line)
    ).toEqual([5]);
  });

  it("flags the callback handed to a wrapper declared in the file", () => {
    expect(
      snippets(`function leaseTest(name: string, fn: (f: Fixture) => Promise<void>) {
  databaseTest(name, async () => {
    const f = await leaseFixture();
    await fn(f);
  });
}
const versionTest = (name: string, fn: () => Promise<void>) =>
  leaseTest(name, () => fn());

leaseTest("a", async (f) => {
  if (!f.lease) return;
});
versionTest("b", async () => {
  if (!client) return;
});`)
    ).toEqual(["if (!f.lease) return;", "if (!client) return;"]);
  });

  it("accepts guards in hooks, which skip setup the skipped cases need", () => {
    expect(
      scanSilentPass(`beforeAll(async () => {
  if (!client) return;
});
afterAll(async () => {
  if (!f) return;
});
beforeEach(() => {
  if (!client) return;
});
afterEach(() => {
  if (!client) return;
});`)
    ).toEqual([]);
  });

  it("accepts a return inside a function nested in the case", () => {
    expect(
      scanSilentPass(`it("a", async () => {
  items.forEach((item) => {
    if (!item.str) return;
  });
  await seed(f, async (trx) => {
    if (rows.length === 0) return;
  });
  const walk = function (node) {
    if (!node) return;
  };
  for (const row of rows) {
    if (!row) continue;
  }
  if (ready) {
    if (!client) return;
  }
});`)
    ).toEqual([]);
  });

  it("accepts a guard that narrows what the line before asserted", () => {
    expect(
      scanSilentPass(`it("a", () => {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.definition).toEqual({});
});`)
    ).toEqual([]);
    expect(
      snippets(`it("a", () => {
  expect(other.ok).toBe(true);
  if (!result.ok) return;
});`)
    ).toEqual(["if (!result.ok) return;"]);
  });

  it("accepts guards that throw, return a value or test for presence", () => {
    expect(
      scanSilentPass(`it("a", async () => {
  if (!client) throw new Error("no client");
  if (client) return;
  if (!client) return expect(x).toBe(1);
  if (rows.length > 0) return;
});`)
    ).toEqual([]);
  });

  it("ignores the pattern in comments, strings and describe blocks", () => {
    expect(
      scanSilentPass(`// it("a", async () => { if (!client) return; });
const doc = 'it("a", () => { if (!client) return; })';
describe("a", () => {
  if (!client) return;
});
regex.test("a", () => {
  if (!client) return;
});`)
    ).toEqual([]);
  });

  it("ignores a helper's guard in a file that names test without declaring a case", () => {
    expect(
      scanSilentPass(`function seed(client) {
  if (!client) return;
  insert(client);
}
const withLease = test.extend({});`)
    ).toEqual([]);
  });

  it("reports each guard once, on its own line", () => {
    expect(
      scanSilentPass(`it("a", async () => {
  if (!a) return;

  if (!b) return;
});

test("b", async () => {
  if (!c) return;
});`).map((v) => [v.line, v.snippet])
    ).toEqual([
      [2, "if (!a) return;"],
      [4, "if (!b) return;"],
      [8, "if (!c) return;"]
    ]);
  });
});

describe("sharedTestWrappers", () => {
  const fixture = (file: string, contents: string) => ({ file, contents });

  it("finds exported wrappers, a wrapper of another file's wrapper among them", () => {
    expect(
      sharedTestWrappers([
        fixture(
          "b.ts",
          `export const fooTest = (name: string, fn: () => Promise<void>) =>
  barTest(name, fn);`
        ),
        fixture(
          "a.ts",
          `export function barTest(name: string, fn: () => void) {
  it.skipIf(!db)(name, fn, 60_000);
}
function localTest(name: string, fn: () => void) {
  it(name, fn);
}
export function helper(f: Fixture) {
  return f.db;
}`
        )
      ]).sort()
    ).toEqual(["barTest", "fooTest"]);
  });

  it("reads databaseTest and postgrestTest from the real fixtures", () => {
    expect(sharedTestWrappers(loadSharedTestFixtures(repoRoot()))).toEqual(
      expect.arrayContaining(["databaseTest", "postgrestTest"])
    );
  });
});
