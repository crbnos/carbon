// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MANAGED_FUNCTION_SETS } from "../conformance/no-authz-ddl-in-migrations";
import { repoRoot } from "../sources/migrations";
import { buildBriefIndex } from "./index-builder";

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "brief-index-"));
  mkdirSync(join(root, ".claude/rules"), { recursive: true });
  mkdirSync(join(root, ".ai/lessons"), { recursive: true });
  // The migrations check reads its managed functions from the real repo shape.
  for (const { dir } of MANAGED_FUNCTION_SETS) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(
    join(root, ".claude/rules/database-patterns.md"),
    [
      "---",
      "paths:",
      '  - "apps/erp/app/modules/**/*.service.ts"',
      "triggers:",
      '  - "ctx.transaction"',
      '  - { text: ".update(", minCount: 2 }',
      "summary:",
      '  - "Chained supabase-js writes are not a transaction."',
      "---",
      "# Database Access Patterns",
      "",
      "Body."
    ].join("\n")
  );
  writeFileSync(
    join(root, ".ai/lessons/count-invoices.md"),
    [
      "---",
      'paths: ["apps/erp/app/modules/*/ui/**/*Dashboard*"]',
      'triggers: ["purchaseInvoices"]',
      "promoted: null",
      "---",
      "# Count invoices from the view",
      "",
      "**Problem:** The card counted the table.",
      "",
      "**Rule:** Count by the view's status,",
      "never the table's.",
      "",
      "**Applies to:** dashboards."
    ].join("\n")
  );
  writeFileSync(join(root, ".ai/lessons/README.md"), "# Lessons\n");
  return root;
}

it("reads each rule's and lesson's scope, title and guidance", () => {
  const index = buildBriefIndex(fixtureRoot());
  expect({ rules: index.rules, lessons: index.lessons }).toEqual({
    rules: [
      {
        id: ".claude/rules/database-patterns.md",
        title: "Database Access Patterns",
        paths: ["apps/erp/app/modules/**/*.service.ts"],
        triggers: ["ctx.transaction", { text: ".update(", minCount: 2 }],
        summary: ["Chained supabase-js writes are not a transaction."]
      }
    ],
    lessons: [
      {
        id: ".ai/lessons/count-invoices.md",
        title: "Count invoices from the view",
        paths: ["apps/erp/app/modules/*/ui/**/*Dashboard*"],
        triggers: ["purchaseInvoices"],
        rule: "Count by the view's status, never the table's."
      }
    ]
  });
});

it("lists a check once per file set it runs in, with its fix", () => {
  const redirect = buildBriefIndex(repoRoot()).checks.filter(
    (check) => check.id === "no-raw-redirect"
  );
  expect(redirect).toEqual([
    {
      id: "no-raw-redirect",
      set: "request-handling",
      description:
        "Redirect with redirect / redirectExternal from @carbon/utils",
      replacedBy: "redirect, redirectExternal (@carbon/utils)",
      triggers: ["react-router"]
    }
  ]);
});
