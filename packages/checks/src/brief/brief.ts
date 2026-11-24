// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { keyOf } from "../baseline";
import type { Violation } from "../check";
import { FILE_SETS } from "./file-sets";
import type {
  BriefIndex,
  CheckEntry,
  LessonEntry,
  RuleEntry
} from "./index-builder";
import { matchesPath, matchingTriggers } from "./scope";

export type BriefInput = {
  root: string;
  /** Repo-relative path of the file being edited. */
  path: string;
  /** The file's current content; "" for a new file. */
  before: string;
  /** The content after the planned edit. */
  after: string;
  index: BriefIndex;
  baseline: Set<string>;
  /** Entry ids already shown in this session. */
  seen?: Set<string>;
};

export type Refusal = {
  checkId: string;
  line: number;
  message: string;
  replacedBy: string;
};

/**
 * How an entry matched. `broad` is a match by a glob such as `apps/**` only:
 * Claude Code loads such a rule whenever the file opens, so the briefing
 * names it instead of repeating it.
 */
export type Match = "trigger" | "path" | "broad";

export type Briefing = {
  refusals: Refusal[];
  lessons: (LessonEntry & { match: Match })[];
  rules: (RuleEntry & { match: Match })[];
  checks: CheckEntry[];
};

const MATCH_ORDER: Record<Match, number> = { trigger: 0, path: 1, broad: 2 };

/**
 * A glob whose fixed folders stop at the repo, an app or a package root
 * (`apps/**`, `apps/erp/app/**`, `packages/database/**`, `**\/*.test.ts`).
 */
export function isBroadGlob(glob: string): boolean {
  const wildcard = glob.search(/[*?[{]/);
  if (wildcard === -1) return false;
  const folders = glob.slice(0, wildcard).split("/").slice(0, -1);
  if (folders.length < 2) return true;
  const [top, , third] = folders;
  if (top !== "apps" && top !== "packages") return false;
  return (
    folders.length === 2 ||
    (folders.length === 3 && (third === "app" || third === "src"))
  );
}

/** Applies one Edit tool call the way the tool does. */
export function applyEdit(
  before: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): string {
  if (oldString === "") return newString;
  if (replaceAll) return before.split(oldString).join(newString);
  const at = before.indexOf(oldString);
  if (at === -1) return before;
  return before.slice(0, at) + newString + before.slice(at + oldString.length);
}

type Found = { checkId: string; violation: Violation; replacedBy: string };

function scanBoth(input: BriefInput): { before: Found[]; after: Found[] } {
  const before: Found[] = [];
  const after: Found[] = [];
  for (const set of FILE_SETS) {
    if (!set.includes(input.path)) continue;
    const file = set.violationFile(input.path);
    for (const check of set.checks(input.root)) {
      const scan = (contents: string, out: Found[]) => {
        if (contents === "") return;
        for (const violation of check.scan(
          file,
          set.prepare(input.path, contents)
        )) {
          out.push({
            checkId: check.id,
            violation,
            replacedBy: check.provenance.replacedBy
          });
        }
      };
      scan(input.before, before);
      scan(input.after, after);
    }
  }
  return { before, after };
}

/**
 * What applies to one planned edit: the check violations it would add, and
 * the lessons, rules and checks whose scope matches the file or the edit.
 */
export function brief(input: BriefInput): Briefing {
  const { before, after } = scanBoth(input);
  const existing = new Set(before.map((f) => keyOf(f.checkId, f.violation)));
  const refusals = after
    .filter((f) => {
      const key = keyOf(f.checkId, f.violation);
      return !existing.has(key) && !input.baseline.has(key);
    })
    .map((f) => ({
      checkId: f.checkId,
      line: f.violation.line,
      message: f.violation.message,
      replacedBy: f.replacedBy
    }));

  const text = input.after;
  const matchOf = (entry: {
    paths: string[];
    triggers: RuleEntry["triggers"];
  }): Match | null => {
    if (matchingTriggers(text, entry.triggers).length > 0) return "trigger";
    const globs = entry.paths.filter((glob) => matchesPath(input.path, [glob]));
    if (globs.length === 0) return null;
    return globs.every(isBroadGlob) ? "broad" : "path";
  };
  const select = <
    T extends { id: string; paths: string[]; triggers: RuleEntry["triggers"] }
  >(
    entries: T[]
  ) =>
    entries
      .map((entry) => ({ ...entry, match: matchOf(entry) }))
      .filter(
        (entry): entry is T & { match: Match } =>
          entry.match !== null && !input.seen?.has(entry.id)
      )
      .sort((a, b) => MATCH_ORDER[a.match] - MATCH_ORDER[b.match]);
  const unseen = (id: string) => !input.seen?.has(id);

  const setsOfPath = new Set(
    FILE_SETS.filter((set) => set.includes(input.path)).map((set) => set.name)
  );
  const refused = new Set(refusals.map((r) => r.checkId));

  return {
    refusals,
    lessons: select(input.index.lessons),
    rules: select(input.index.rules),
    checks: input.index.checks.filter(
      (c, i, all) =>
        setsOfPath.has(c.set) &&
        !refused.has(c.id) &&
        matchingTriggers(text, c.triggers).length > 0 &&
        unseen(`check:${c.id}`) &&
        all.findIndex((other) => other.id === c.id) === i
    )
  };
}

/** The ids a briefing showed, for the session's seen set. */
export function shownIds(b: Briefing): string[] {
  return [
    ...b.lessons.map((l) => l.id),
    ...b.rules.map((r) => r.id),
    ...b.checks.map((c) => `check:${c.id}`)
  ];
}

export function isEmpty(b: Briefing): boolean {
  return (
    b.refusals.length === 0 &&
    b.lessons.length === 0 &&
    b.rules.length === 0 &&
    b.checks.length === 0
  );
}

/**
 * Text for the agent: refusals first, then lessons, rules and checks. Past
 * `budgetChars` (about 2k tokens) each remaining entry shows by id only.
 */
export function formatBriefing(b: Briefing, budgetChars = 8000): string {
  const blocks: { id: string; text: string }[] = [];
  if (b.refusals.length > 0) {
    blocks.push({
      id: "refusals",
      text: [
        `Refused: this edit adds ${b.refusals.length} new check violation${b.refusals.length === 1 ? "" : "s"}.`,
        ...b.refusals.map(
          (r) =>
            `- ${r.checkId} (line ${r.line}): ${r.message}. Use instead: ${r.replacedBy}.`
        )
      ].join("\n")
    });
  }
  for (const lesson of b.lessons) {
    blocks.push({
      id: lesson.id,
      text: `Lesson: ${lesson.title} (${lesson.id})\n  ${lesson.rule}`
    });
  }
  const broad = b.rules.filter((rule) => rule.match === "broad");
  for (const rule of b.rules.filter((r) => r.match !== "broad")) {
    blocks.push({
      id: rule.id,
      text: [
        `Rule: ${rule.title} (${rule.id})`,
        ...rule.summary.map((line) => `  - ${line}`)
      ].join("\n")
    });
  }
  for (const check of b.checks) {
    blocks.push({
      id: `check:${check.id}`,
      text: `Check: ${check.id}: ${check.description}. Use: ${check.replacedBy}.`
    });
  }
  if (broad.length > 0) {
    blocks.push({
      id: "broad",
      text: `Also in scope (loaded with the file): ${broad.map((r) => r.id).join(", ")}`
    });
  }

  const shown: string[] = [];
  const rest: string[] = [];
  let used = 0;
  for (const block of blocks) {
    // Refusals always show in full: they are the reason the edit stopped.
    if (block.id === "refusals" || used + block.text.length <= budgetChars) {
      shown.push(block.text);
      used += block.text.length;
    } else {
      rest.push(
        block.id === "broad" ? broad.map((r) => r.id).join(", ") : block.id
      );
    }
  }
  if (rest.length > 0) shown.push(`More that applies: ${rest.join(", ")}`);
  return shown.join("\n\n");
}
