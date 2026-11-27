// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Claude Code Stop hook: when this worktree logged check failures or refused
// edits since its last /learn, ask the agent once per session to run /learn
// before it stops. Run by .claude/hooks/learn-stop.sh.

import {
  appendSignal,
  pendingSignals,
  readSignals,
  type Signal
} from "../learn/inbox";
import { repoRoot } from "../sources/migrations";

export type StopInput = { session_id?: string; stop_hook_active?: boolean };

export type StopOutput = { decision: "block"; reason: string };

/** Pure: whether to ask for /learn now. */
export function decideStop(
  input: StopInput,
  signals: Signal[],
  worktree: string
): StopOutput | null {
  if (input.stop_hook_active) return null;
  const sessionId = input.session_id ?? "no-session";
  const askedBefore = signals.some(
    (s) => s.kind === "stop-asked" && s.sessionId === sessionId
  );
  if (askedBefore) return null;
  const pending = pendingSignals(signals, worktree);
  if (pending.length === 0) return null;
  const ids = [...new Set(pending.map((s) => s.checkId ?? "unknown"))].sort();
  return {
    decision: "block",
    reason: `This worktree logged ${pending.length} check failure${pending.length === 1 ? "" : "s"} (${ids.join(", ")}) since the last /learn. Run /learn on them before you stop. If each one was a slip already covered by its check, run \`pnpm --filter @carbon/checks learn:mark\` instead.`
  };
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
  const input = JSON.parse((await readStdin()) || "{}") as StopInput;
  const worktree = repoRoot();
  const output = decideStop(input, readSignals(), worktree);
  if (!output) return;
  appendSignal({
    kind: "stop-asked",
    at: new Date().toISOString(),
    worktree,
    sessionId: input.session_id ?? "no-session"
  });
  process.stdout.write(JSON.stringify(output));
}

if (process.argv[1]?.endsWith("stop.ts")) {
  // A broken hook must never keep the agent from stopping.
  main().catch((error) => {
    process.stderr.write(`learn stop hook failed: ${String(error)}\n`);
  });
}
