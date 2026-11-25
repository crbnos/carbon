// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  annotation,
  type GuardedEntry,
  markerSpans,
  parseDiff,
  parseRegistry,
  touchedGuards
} from "./guarded-code";

// Lines numbered as the hunks below refer to them.
const SOURCE = [
  /*  1 */ 'import { sql } from "kysely";',
  /*  2 */ "",
  /*  3 */ "/** Locks the period, then moves it. */",
  /*  4 */ "export async function lockAccountingPeriod(db, id) {",
  /*  5 */ "  await db.lock(id);",
  /*  6 */ '  return move(db, id, "Locked");',
  /*  7 */ "}",
  /*  8 */ "",
  /*  9 */ "export async function postEverything(db) {",
  /* 10 */ "  for (const row of rows) {",
  /* 11 */ "    // guarded: the void branch",
  /* 12 */ "    await db.lock(row.id);",
  /* 13 */ "    await db.void(row.id);",
  /* 14 */ "  }",
  /* 15 */ "  await db.done();",
  /* 16 */ "}"
].join("\n");

const ENTRY: GuardedEntry = {
  file: "apps/erp/app/modules/accounting/accounting.service.ts",
  functions: ["lockAccountingPeriod", "missingOnThisBranch"],
  markers: ["// guarded: the void branch"],
  tests: ["apps/erp/test/database/period-close-concurrency.test.ts"]
};

const hunk = (
  newStart: number,
  newCount: number,
  oldStart = newStart,
  oldCount = newCount
) => ({
  oldStart,
  oldCount,
  newStart,
  newCount
});

describe("markerSpans", () => {
  it("runs from the marker to the end of its indentation", () => {
    expect(markerSpans(SOURCE, "// guarded: the void branch")).toEqual([
      { name: "// guarded: the void branch", start: 11, end: 13 }
    ]);
  });

  it("keeps going past a blank line inside the marked block", () => {
    const source = [
      "function post() {",
      "  // guarded: posting",
      "  lock();",
      "",
      "  write();",
      "}"
    ].join("\n");
    expect(markerSpans(source, "// guarded: posting")).toEqual([
      { name: "// guarded: posting", start: 2, end: 5 }
    ]);
  });
});

describe("touchedGuards", () => {
  it("names a guarded function an edited line falls in, at that line", () => {
    expect(touchedGuards(ENTRY, [hunk(5, 1)], SOURCE, SOURCE)).toEqual([
      {
        file: ENTRY.file,
        name: "lockAccountingPeriod",
        line: 5,
        tests: ENTRY.tests
      }
    ]);
  });

  it("counts an edit of the function's comment, and of a marked block", () => {
    expect(
      touchedGuards(ENTRY, [hunk(3, 1), hunk(12, 2)], SOURCE, SOURCE).map(
        (t) => [t.name, t.line]
      )
    ).toEqual([
      ["lockAccountingPeriod", 3],
      ["// guarded: the void branch", 12]
    ]);
  });

  it("ignores edits outside guarded code", () => {
    expect(
      touchedGuards(ENTRY, [hunk(1, 1), hunk(15, 1)], SOURCE, SOURCE)
    ).toEqual([]);
  });

  it("sees lines removed from a guarded function in the old source", () => {
    const old = SOURCE.replace(
      "  await db.lock(id);\n",
      "  await db.lock(id);\n  await db.check(id);\n"
    );
    // Old line 6 (the check) is removed; the new file has nothing at it.
    expect(
      touchedGuards(ENTRY, [hunk(5, 0, 6, 1)], SOURCE, old).map((t) => [
        t.name,
        t.line
      ])
    ).toEqual([["lockAccountingPeriod", 3]]);
  });

  it("skips a file or a function missing on this branch", () => {
    expect(touchedGuards(ENTRY, [hunk(5, 1)], null, null)).toEqual([]);
    const other = SOURCE.replace("lockAccountingPeriod", "somethingElse");
    expect(touchedGuards(ENTRY, [hunk(5, 1)], other, other)).toEqual([]);
  });
});

describe("parseDiff", () => {
  it("reads each file's hunks from git diff -U0, a count of 1 left out", () => {
    const diff = `diff --git a/a.ts b/a.ts
index 1..2 100644
--- a/a.ts
+++ b/a.ts
@@ -5 +5,2 @@ export async function lockAccountingPeriod(
-  await db.lock(id);
+  await db.lock(id, true);
+  await db.check(id);
@@ -10,3 +11,0 @@ x
diff --git a/b.ts b/b.ts
deleted file mode 100644
--- a/b.ts
+++ /dev/null
@@ -1,2 +0,0 @@
`;
    expect(Object.fromEntries(parseDiff(diff))).toEqual({
      "a.ts": [
        { oldStart: 5, oldCount: 1, newStart: 5, newCount: 2 },
        { oldStart: 10, oldCount: 3, newStart: 11, newCount: 0 }
      ],
      "b.ts": [{ oldStart: 1, oldCount: 2, newStart: 0, newCount: 0 }]
    });
  });
});

describe("annotation", () => {
  it("is a GitHub Actions warning on the touched line", () => {
    expect(
      annotation({
        file: "a.ts",
        name: "lockAccountingPeriod",
        line: 5,
        tests: ["t1.test.ts", "t2.test.ts"]
      })
    ).toBe(
      "::warning file=a.ts,line=5::lockAccountingPeriod is race-protected; t1.test.ts, t2.test.ts prove its fix — keep them passing (Database tests job)"
    );
  });
});

describe("guarded-code.json", () => {
  it("names a file, a function or marker, and a test for every entry", () => {
    const registry = parseRegistry(
      readFileSync(join(__dirname, "../guarded-code.json"), "utf8")
    );
    expect(registry.length).toBeGreaterThan(0);
    expect(() =>
      parseRegistry(
        '{"guarded":[{"file":"a.ts","functions":["f"],"tests":[]}]}'
      )
    ).toThrow("names no test that proves its fix");
  });
});
