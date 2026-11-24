// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { keyOf } from "../baseline";
import { repoRoot } from "../sources/migrations";
import {
  applyEdit,
  type BriefInput,
  brief,
  formatBriefing,
  isBroadGlob
} from "./brief";
import type { BriefIndex } from "./index-builder";

const root = repoRoot();
const ROUTE = "apps/erp/app/routes/x+/__brief-fixture.tsx";

const index: BriefIndex = {
  rules: [
    {
      id: ".claude/rules/coding-conventions.md",
      title: "Coding Conventions",
      paths: ["apps/**"],
      triggers: [],
      summary: ["Never use console.*."]
    },
    {
      id: ".claude/rules/database-patterns.md",
      title: "Database Access Patterns",
      paths: ["apps/erp/app/modules/**/*.service.ts"],
      triggers: [{ text: ".update(", minCount: 2 }],
      summary: ["Chained supabase-js writes are not a transaction."]
    }
  ],
  lessons: [
    {
      id: ".ai/lessons/route-writes.md",
      title: "Chained writes in a route action are not a transaction",
      paths: ["apps/erp/app/routes/**", "packages/utils/src/**"],
      triggers: [],
      rule: "Move both writes into one service function."
    }
  ],
  checks: []
};

const input = (overrides: Partial<BriefInput>): BriefInput => ({
  root,
  path: ROUTE,
  before: "",
  after: "",
  index,
  baseline: new Set(),
  ...overrides
});

// Every fixture starts with its license header, so only the check under test fires.
const HEADER =
  "// SPDX-License-Identifier: AGPL-3.0-only\n// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,\n// including ports, remain AGPLv3; serving them over a network requires releasing their source.\n\n";
const RAW_REDIRECT = `${HEADER}import { redirect } from "react-router";\n`;
const TWO_WRITES =
  HEADER +
  'const a = await client.from("a").update({}).eq("id", 1);\nif (a.error) throw a.error;\nconst b = await client.from("b").update({}).eq("id", 2);\nif (b.error) throw b.error;\n';

describe("brief", () => {
  it("selects a rule by its trigger in a file its paths do not cover", () => {
    expect(brief(input({ after: TWO_WRITES })).rules.map((r) => r.id)).toEqual([
      ".claude/rules/database-patterns.md",
      ".claude/rules/coding-conventions.md"
    ]);
  });

  it("does not select the rule for one write", () => {
    expect(
      brief(input({ after: 'await client.from("a").update({});\n' })).rules.map(
        (r) => r.id
      )
    ).toEqual([".claude/rules/coding-conventions.md"]);
  });

  it("refuses an edit that adds a check violation", () => {
    expect(
      brief(input({ after: RAW_REDIRECT })).refusals.map((r) => r.checkId)
    ).toEqual(["no-raw-redirect"]);
  });

  it("does not refuse a violation the file already had", () => {
    expect(
      brief(input({ before: RAW_REDIRECT, after: `${RAW_REDIRECT}// edit\n` }))
        .refusals
    ).toEqual([]);
  });

  it("does not refuse a violation that is in the baseline", () => {
    const baseline = new Set([
      keyOf("no-raw-redirect", {
        file: ROUTE,
        line: 5,
        snippet: 'import { redirect } from "react-router"',
        message: ""
      })
    ]);
    expect(brief(input({ after: RAW_REDIRECT, baseline })).refusals).toEqual(
      []
    );
  });

  it("leaves out entries already shown this session", () => {
    const b = brief(
      input({
        after: TWO_WRITES,
        seen: new Set([
          ".claude/rules/database-patterns.md",
          ".claude/rules/coding-conventions.md",
          ".ai/lessons/route-writes.md"
        ])
      })
    );
    expect({ rules: b.rules, lessons: b.lessons }).toEqual({
      rules: [],
      lessons: []
    });
  });
});

describe("formatBriefing", () => {
  it("lists entries past the budget by id only", () => {
    const text = formatBriefing(
      brief(
        input({
          path: "packages/utils/src/__brief-fixture.ts",
          after: TWO_WRITES
        })
      ),
      150
    );
    expect(text).toBe(
      [
        "Lesson: Chained writes in a route action are not a transaction (.ai/lessons/route-writes.md)",
        "  Move both writes into one service function.",
        "",
        "More that applies: .claude/rules/database-patterns.md"
      ].join("\n")
    );
  });
});

describe("applyEdit", () => {
  it("replaces the first match only", () => {
    expect(applyEdit("a a", "a", "b", false)).toBe("b a");
  });

  it("replaces every match with replaceAll", () => {
    expect(applyEdit("a a", "a", "b", true)).toBe("b b");
  });
});

describe("rule order and broad globs", () => {
  it("puts a trigger match first and a broad-glob match last", () => {
    expect(
      brief(input({ after: TWO_WRITES })).rules.map((r) => [r.id, r.match])
    ).toEqual([
      [".claude/rules/database-patterns.md", "trigger"],
      [".claude/rules/coding-conventions.md", "broad"]
    ]);
  });

  it("ranks a trigger in the edit above a path match, and one elsewhere in the file below it", () => {
    const path = "apps/erp/app/modules/sales/__brief-fixture.service.ts";
    const inEdit = brief(input({ path, after: TWO_WRITES, edit: TWO_WRITES }));
    const inFile = brief(
      input({ path, after: TWO_WRITES, edit: "// a comment\n" })
    );
    expect({
      inEdit: inEdit.lessons.concat().map((l) => l.match),
      ruleInEdit: inEdit.rules.find(
        (r) => r.id === ".claude/rules/database-patterns.md"
      )?.match,
      ruleInFile: inFile.rules.find(
        (r) => r.id === ".claude/rules/database-patterns.md"
      )?.match
    }).toEqual({ inEdit: [], ruleInEdit: "edit", ruleInFile: "path" });
  });

  it("names a broad-glob rule instead of repeating its summary", () => {
    const text = formatBriefing(
      brief(
        input({
          path: "apps/mes/app/__brief-fixture.ts",
          after: `${HEADER}export const a = 1;\n`
        })
      )
    );
    expect(text).toBe(
      "Also in scope (loaded with the file): .claude/rules/coding-conventions.md"
    );
  });

  it.each([
    ["apps/**", true],
    ["**/*.test.ts", true],
    ["packages/**", true],
    ["packages/database/**", true],
    ["apps/erp/app/**", true],
    ["packages/utils/src/**", true],
    ["apps/erp/app/routes/x+/**", false],
    ["packages/database/supabase/migrations/**", false],
    ["apps/erp/app/modules/**/*.service.ts", false],
    ["apps/erp/app/modules/sales/sales.service.ts", false]
  ])("isBroadGlob(%s) is %s", (glob, broad) => {
    expect(isBroadGlob(glob)).toBe(broad);
  });
});
