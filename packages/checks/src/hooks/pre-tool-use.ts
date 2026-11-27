// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Claude Code PreToolUse hook for Edit, Write and MultiEdit: briefs the agent
// on the checks, rules and lessons in scope before the write, and refuses a
// write that adds a check violation. Run by .claude/hooks/brief-pre-tool-use.sh.

import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative } from "node:path";
import { loadBaseline } from "../baseline";
import {
  applyEdit,
  type Briefing,
  brief,
  formatBriefing,
  isEmpty,
  shownIds
} from "../brief/brief";
import { type BriefIndex, buildBriefIndex } from "../brief/index-builder";
import { appendSignal, inboxPath } from "../learn/inbox";
import { repoRoot } from "../sources/migrations";
import { loadSqlParser } from "../sources/sql";
import { loadSeen, saveSeen } from "./session-state";

type EditInput = {
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
};

export type HookInput = {
  session_id?: string;
  scratchpad_dir?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    edits?: EditInput[];
  } & EditInput;
};

export type HookOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
};

export type HookDeps = {
  root: string;
  index: BriefIndex;
  baseline: Set<string>;
  seen: Set<string>;
  readFile(path: string): string;
};

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

/** The file as it would be after the tool call. */
function plannedContent(input: HookInput, before: string): string {
  const tool = input.tool_input ?? {};
  if (input.tool_name === "Write") return tool.content ?? "";
  const edits: EditInput[] =
    input.tool_name === "MultiEdit" ? (tool.edits ?? []) : [tool];
  return edits.reduce(
    (text, edit) =>
      applyEdit(
        text,
        edit.old_string ?? "",
        edit.new_string ?? "",
        edit.replace_all ?? false
      ),
    before
  );
}

/** The text the tool call adds: the whole Write, or each Edit's new text. */
function addedText(input: HookInput): string {
  const tool = input.tool_input ?? {};
  if (input.tool_name === "Write") return tool.content ?? "";
  const edits: EditInput[] =
    input.tool_name === "MultiEdit" ? (tool.edits ?? []) : [tool];
  return edits.map((edit) => edit.new_string ?? "").join("\n");
}

/** Pure: what the hook answers for one tool call, and what it showed. */
export function decide(
  input: HookInput,
  deps: HookDeps
): { output: HookOutput | null; briefing: Briefing | null } {
  const filePath = input.tool_input?.file_path;
  if (!input.tool_name || !WRITE_TOOLS.has(input.tool_name) || !filePath) {
    return { output: null, briefing: null };
  }
  const path = relative(deps.root, filePath);
  if (path.startsWith("..") || isAbsolute(path)) {
    return { output: null, briefing: null };
  }
  const before = deps.readFile(filePath);
  const briefing = brief({
    root: deps.root,
    path,
    before,
    after: plannedContent(input, before),
    edit: addedText(input),
    index: deps.index,
    baseline: deps.baseline,
    seen: deps.seen
  });
  if (isEmpty(briefing)) return { output: null, briefing };
  const text = formatBriefing(briefing);
  if (briefing.refusals.length > 0) {
    return {
      briefing,
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: text
        }
      }
    };
  }
  return {
    briefing,
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: `Before you edit ${path}:\n\n${text}`
      }
    }
  };
}

/** One `refused-edit` signal per refusal. A write error never fails the hook. */
export function recordRefusals(
  briefing: Briefing,
  context: { root: string; sessionId: string; file: string },
  path = inboxPath()
): void {
  const at = new Date().toISOString();
  for (const refusal of briefing.refusals) {
    try {
      appendSignal(
        {
          kind: "refused-edit",
          at,
          worktree: context.root,
          checkId: refusal.checkId,
          file: context.file,
          sessionId: context.sessionId
        },
        path
      );
    } catch {
      return;
    }
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

async function main() {
  const input = JSON.parse((await readStdin()) || "{}") as HookInput;
  // The SQL checks parse with libpg-query, whose WASM module loads once.
  await loadSqlParser();
  const root = repoRoot();
  const sessionId = input.session_id ?? "no-session";
  const stateDir = input.scratchpad_dir ?? tmpdir();
  const seen = loadSeen(stateDir, sessionId);
  const { output, briefing } = decide(input, {
    root,
    index: buildBriefIndex(root),
    baseline: loadBaseline(),
    seen,
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : "")
  });
  if (briefing) {
    for (const id of shownIds(briefing)) seen.add(id);
    saveSeen(stateDir, sessionId, seen);
    recordRefusals(briefing, {
      root,
      sessionId,
      file: relative(root, input.tool_input?.file_path ?? "")
    });
  }
  if (output) process.stdout.write(JSON.stringify(output));
}

if (process.argv[1]?.endsWith("pre-tool-use.ts")) {
  // A broken hook must never block an edit: report and exit 0.
  main().catch((error) => {
    process.stderr.write(`brief hook failed: ${String(error)}\n`);
  });
}
