// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shownIds } from "../brief/brief";
import type { BriefIndex } from "../brief/index-builder";
import { repoRoot } from "../sources/migrations";
import { decide, type HookDeps } from "./pre-tool-use";
import { loadSeen, saveSeen } from "./session-state";

const root = repoRoot();
const HEADER =
  "// SPDX-License-Identifier: AGPL-3.0-only\n// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,\n// including ports, remain AGPLv3; serving them over a network requires releasing their source.\n\n";

const index: BriefIndex = {
  rules: [
    {
      id: ".claude/rules/database-patterns.md",
      title: "Database Access Patterns",
      paths: ["apps/erp/app/modules/**/*.service.ts"],
      triggers: [{ text: ".update(", minCount: 2 }],
      summary: ["Chained supabase-js writes are not a transaction."]
    }
  ],
  lessons: [],
  checks: []
};

const deps = (seen = new Set<string>()): HookDeps => ({
  root,
  index,
  baseline: new Set(),
  seen,
  readFile: () => ""
});

const SERVICE = join(
  root,
  "apps/erp/app/modules/sales/__hook-fixture.service.ts"
);
const TWO_WRITES = `${HEADER}await db.from("a").update({});\nawait db.from("b").update({});\n`;

describe("decide", () => {
  it("refuses a Write that adds a raw react-router redirect", () => {
    const { output } = decide(
      {
        tool_name: "Write",
        tool_input: {
          file_path: join(root, "apps/erp/app/routes/x+/__hook-fixture.tsx"),
          content: `${HEADER}import { redirect } from "react-router";\n`
        }
      },
      deps()
    );
    expect(output?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output?.hookSpecificOutput.permissionDecisionReason).toContain(
      "no-raw-redirect"
    );
  });

  it("briefs an Edit with the rule its planned text triggers", () => {
    const { output } = decide(
      {
        tool_name: "Edit",
        tool_input: {
          file_path: SERVICE,
          old_string: "",
          new_string: TWO_WRITES
        }
      },
      deps()
    );
    expect(output?.hookSpecificOutput).toEqual({
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext:
        "Before you edit apps/erp/app/modules/sales/__hook-fixture.service.ts:\n\nRule: Database Access Patterns (.claude/rules/database-patterns.md)\n  - Chained supabase-js writes are not a transaction."
    });
  });

  it("ignores a tool that does not write", () => {
    expect(
      decide({ tool_name: "Read", tool_input: { file_path: SERVICE } }, deps())
        .output
    ).toBeNull();
  });

  it("ignores a file outside the repository", () => {
    expect(
      decide(
        {
          tool_name: "Write",
          tool_input: { file_path: "/tmp/elsewhere.ts", content: TWO_WRITES }
        },
        deps()
      ).output
    ).toBeNull();
  });

  it("says nothing the second time the same session sees the same entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "brief-session-"));
    const call = {
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: SERVICE, content: TWO_WRITES }
    };
    const first = decide(call, deps(loadSeen(dir, "s1")));
    const seen = loadSeen(dir, "s1");
    for (const id of first.briefing ? shownIds(first.briefing) : [])
      seen.add(id);
    saveSeen(dir, "s1", seen);
    expect(decide(call, deps(loadSeen(dir, "s1"))).output).toBeNull();
  });
});
