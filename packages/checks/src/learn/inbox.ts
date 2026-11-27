// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * One event the learning loop reads. `gate-failure` and `refused-edit` are
 * mistakes; `learned` marks that /learn ran for a worktree; `stop-asked`
 * marks that the Stop hook asked once in a session.
 */
export type Signal = {
  kind: "gate-failure" | "refused-edit" | "learned" | "stop-asked";
  /** An absolute instant (ISO 8601, UTC). */
  at: string;
  worktree: string;
  branch?: string;
  checkId?: string;
  file?: string;
  sessionId?: string;
};

/** One file per machine: worktrees cannot see each other's ignored files. */
export function inboxPath(): string {
  return (
    process.env.CARBON_LEARN_INBOX ??
    join(homedir(), ".carbon", "learn-inbox.jsonl")
  );
}

export function appendSignal(signal: Signal, path = inboxPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(signal)}\n`);
}

export function readSignals(path = inboxPath()): Signal[] {
  if (!existsSync(path)) return [];
  const signals: Signal[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      signals.push(JSON.parse(line) as Signal);
    } catch {
      // A torn line from a concurrent append is skipped, never fatal.
    }
  }
  return signals;
}

/** The worktree's mistakes logged after its last `learned` signal. */
export function pendingSignals(signals: Signal[], worktree: string): Signal[] {
  const own = signals.filter((signal) => signal.worktree === worktree);
  let lastLearned = -1;
  own.forEach((signal, index) => {
    if (signal.kind === "learned") lastLearned = index;
  });
  return own
    .slice(lastLearned + 1)
    .filter(
      (signal) =>
        signal.kind === "gate-failure" || signal.kind === "refused-edit"
    );
}
