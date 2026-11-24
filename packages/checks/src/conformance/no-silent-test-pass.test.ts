// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { repoRoot } from "../sources/migrations";
import { loadSharedTestFixtures } from "../sources/test-files";
import { noSilentTestPass, sharedTestWrappers } from "./no-silent-test-pass";

const scan = (contents: string) =>
  noSilentTestPass(["databaseTest", "postgrestTest"]).scan(
    "apps/erp/test/database/x.test.ts",
    contents
  );
const snippets = (contents: string) => scan(contents).map((v) => v.snippet);

describe("noSilentTestPass", () => {
  it("flags the cancel-job wrapper from before 78c72afe13, whose five cases passed unrun", () => {
    // apps/erp/test/database/cancel-job.test.ts before 78c72afe13.
    const source = `const caller = hasLocalDatabase ? localServiceRoleClient() : null;
const cancelTest = (name: string, fn: () => Promise<void>) =>
  databaseTest(name, async () => {
    if (!caller) return;
    await fn();
  });

cancelTest("a Ready job is cancelled", async () => {
  expect(await cancel()).toEqual({ status: "Cancelled" });
});`;
    expect(scan(source)).toEqual([
      {
        file: "apps/erp/test/database/x.test.ts",
        line: 4,
        snippet: "if (!caller) return;",
        message: expect.stringContaining("it.skipIf(!x)")
      }
    ]);
  });

  it("accepts the 78c72afe13 fix, the same wrapper once it skips", () => {
    expect(
      scan(`const caller = hasLocalDatabase ? localServiceRoleClient() : null;
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
      scan(`databaseTest("a", async () => {
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
      scan(`beforeAll(async () => {
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
      scan(`it("a", async () => {
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
      scan(`it("a", () => {
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
      scan(`it("a", async () => {
  if (!client) throw new Error("no client");
  if (client) return;
  if (!client) return expect(x).toBe(1);
  if (rows.length > 0) return;
});`)
    ).toEqual([]);
  });

  it("ignores the pattern in comments, strings and describe blocks", () => {
    expect(
      scan(`// it("a", async () => { if (!client) return; });
const doc = 'it("a", () => { if (!client) return; })';
describe("a", () => {
  if (!client) return;
});
regex.test("a", () => {
  if (!client) return;
});`)
    ).toEqual([]);
  });

  it("reports each guard once, on its own line", () => {
    expect(
      scan(`it("a", async () => {
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
