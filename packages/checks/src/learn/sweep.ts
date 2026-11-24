// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Signal } from "./inbox";

export type RepeatedFailure = {
  checkId: string;
  count: number;
  files: string[];
  worktrees: number;
};

/**
 * Check failures and refused edits since `sinceIso`, per check, kept only when
 * a check failed 2 or more times: a one-off slip never becomes a rule.
 */
export function groupSignals(
  signals: Signal[],
  sinceIso: string
): RepeatedFailure[] {
  const since = Date.parse(sinceIso);
  const groups = new Map<
    string,
    { count: number; files: Set<string>; worktrees: Set<string> }
  >();
  for (const signal of signals) {
    if (signal.kind !== "gate-failure" && signal.kind !== "refused-edit") {
      continue;
    }
    if (Date.parse(signal.at) < since) continue;
    const id = signal.checkId ?? "unknown";
    const group = groups.get(id) ?? {
      count: 0,
      files: new Set<string>(),
      worktrees: new Set<string>()
    };
    group.count += 1;
    if (signal.file) group.files.add(signal.file);
    group.worktrees.add(signal.worktree);
    groups.set(id, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count >= 2)
    .map(([checkId, group]) => ({
      checkId,
      count: group.count,
      files: [...group.files].sort(),
      worktrees: group.worktrees.size
    }))
    .sort((a, b) => b.count - a.count || a.checkId.localeCompare(b.checkId));
}

export type Commit = {
  sha: string;
  subject: string;
  files: string[];
  at: string;
};

export type UnrecordedFix = { sha: string; subject: string; earlier: string[] };

const FIX_SUBJECT = /^fix(\([^)]*\))?!?:/;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Each `fix:` commit whose files another commit changed in the 14 days before
 * it: a mistake that shipped and was corrected, which /learn may not have seen.
 */
export function fixCommitSignals(commits: Commit[]): UnrecordedFix[] {
  const out: UnrecordedFix[] = [];
  for (const fix of commits) {
    if (!FIX_SUBJECT.test(fix.subject)) continue;
    const fixAt = Date.parse(fix.at);
    const touched = new Set(fix.files);
    const earlier = commits
      .filter((other) => {
        if (other.sha === fix.sha) return false;
        const at = Date.parse(other.at);
        return (
          at < fixAt &&
          fixAt - at <= WINDOW_MS &&
          other.files.some((file) => touched.has(file))
        );
      })
      .map((other) => other.sha);
    if (earlier.length > 0) {
      out.push({ sha: fix.sha, subject: fix.subject, earlier });
    }
  }
  return out;
}
