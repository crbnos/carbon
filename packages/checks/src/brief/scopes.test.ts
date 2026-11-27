// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The scopes that `pnpm brief` selects by must stay true: a broken frontmatter
// loads a rule in every session, a loose trigger floods every briefing, and a
// check trigger that a violation's file lacks hides the check before the write.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../sources/migrations";
import { isTest } from "../sources/typescript";
import { FILE_SETS } from "./file-sets";
import { buildBriefIndex } from "./index-builder";
import {
  matchingTriggers,
  parseFrontmatter,
  type Trigger,
  triggerText
} from "./scope";

const root = repoRoot();
const index = buildBriefIndex(root);

/** Every tracked source file under apps and packages that a check can read. */
const sources = execFileSync(
  "git",
  ["ls-files", "-z", "--", "apps", "packages"],
  { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
)
  .split("\0")
  .filter(
    (path) =>
      /\.(ts|tsx|sql|js|jsx|mjs|cjs)$/.test(path) &&
      !path.includes("/node_modules/")
  )
  .map((path) => {
    try {
      return { path, contents: readFileSync(join(root, path), "utf8") };
    } catch {
      return null;
    }
  })
  .filter((file): file is { path: string; contents: string } => file !== null);

/** The reach corpus: non-test .ts, .tsx and .sql files. */
const corpus = sources.filter(
  (file) =>
    /\.(ts|tsx|sql)$/.test(file.path) &&
    !isTest(file.path.split("/").pop() ?? "")
);

/** A rule or a lesson shows its text; a check is one line, in its file set only. */
const MAX_REACH = { entry: 0.25, check: 0.5 };

// Reach is measured on every 8th file: the limits are coarse, and 2,000
// triggers over the whole tree would take about 40 s. One joined string makes
// a plain trigger one indexOf walk.
const sample = corpus.filter((_, i) => i % 8 === 0);
const SEPARATOR = "\u0000";
const joined = sample.map((file) => file.contents).join(SEPARATOR);
const starts: number[] = [];
{
  let at = 0;
  for (const file of sample) {
    starts.push(at);
    at += file.contents.length + SEPARATOR.length;
  }
}
function fileAt(offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const reachCache = new Map<string, number>();
function reach(trigger: Trigger): number {
  const key = JSON.stringify(trigger);
  const cached = reachCache.get(key);
  if (cached !== undefined) return cached;
  let hits = 0;
  if (typeof trigger === "string") {
    let at = joined.indexOf(trigger);
    while (at !== -1) {
      hits += 1;
      const next = fileAt(at) + 1;
      if (next >= starts.length) break;
      at = joined.indexOf(trigger, starts[next]);
    }
  } else {
    hits = sample.filter(
      (file) => matchingTriggers(file.contents, [trigger]).length > 0
    ).length;
  }
  const value = hits / sample.length;
  reachCache.set(key, value);
  return value;
}

describe("rules", () => {
  it("every rule's frontmatter parses and keeps its paths", () => {
    const broken = index.rules
      .filter((rule) => rule.paths.length === 0)
      .map((rule) => rule.id);
    expect(broken).toEqual([]);
  });

  it("every rule has a summary of 1 to 5 lines, each at most 160 characters", () => {
    const bad = index.rules
      .filter(
        (rule) =>
          rule.summary.length < 1 ||
          rule.summary.length > 5 ||
          rule.summary.some((line) => line.length > 160)
      )
      .map((rule) => rule.id);
    expect(bad).toEqual([]);
  });

  it("a rule file whose frontmatter does not parse throws", () => {
    expect(() =>
      parseFrontmatter(
        readFileSync(join(root, ".claude/rules/testing.md"), "utf8").replace(
          "paths:",
          "paths: ["
        )
      )
    ).toThrow();
  });
});

describe("lessons", () => {
  it("every lesson has a unique id and at least one path or trigger", () => {
    const ids = index.lessons.map((l) => l.id);
    const empty = index.lessons
      .filter((l) => l.paths.length === 0 && l.triggers.length === 0)
      .map((l) => l.id);
    expect({
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      empty
    }).toEqual({ duplicateIds: [], empty: [] });
  });

  it("the topic files are exactly the ones the README's table lists", () => {
    const listed = [
      ...readFileSync(join(root, ".ai/lessons/README.md"), "utf8").matchAll(
        /^\| `([a-z0-9-]+\.md)` \|/gm
      )
    ].map((m) => m[1]);
    const files = readdirSync(join(root, ".ai/lessons")).filter(
      (name) => name.endsWith(".md") && name !== "README.md"
    );
    expect(files.sort()).toEqual(listed.sort());
  });

  it("every topic file holds at least one lesson", () => {
    const files = readdirSync(join(root, ".ai/lessons")).filter(
      (name) => name.endsWith(".md") && name !== "README.md"
    );
    const withLessons = new Set(
      index.lessons.map((l) => l.id.split("#")[0]?.split("/").pop())
    );
    expect(files.filter((name) => !withLessons.has(name))).toEqual([]);
  });
});

const allTriggers = [
  ...index.rules.flatMap((r) =>
    r.triggers.map((t) => ({ id: r.id, t, max: MAX_REACH.entry }))
  ),
  ...index.lessons.flatMap((l) =>
    l.triggers.map((t) => ({ id: l.id, t, max: MAX_REACH.entry }))
  ),
  ...index.checks.flatMap((c) =>
    c.triggers.map((t) => ({ id: `check:${c.id}`, t, max: MAX_REACH.check }))
  )
];

describe("triggers", () => {
  it("every trigger has at least 4 characters", () => {
    const short = allTriggers
      .filter(({ t }) => triggerText(t).length < 4)
      .map(({ id, t }) => `${id}: ${triggerText(t)}`);
    expect(short).toEqual([]);
  });

  it("no trigger reaches past its limit: 25% of source files, 50% for a check", () => {
    const loose = allTriggers
      .map(({ id, t, max }) => ({
        id,
        text: triggerText(t),
        max,
        reach: reach(t)
      }))
      .filter((entry) => entry.reach > entry.max)
      .map((e) => `${e.id}: ${e.text} (${Math.round(e.reach * 100)}%)`);
    expect(loose).toEqual([]);
  }, 60_000);
});

describe("check triggers", () => {
  it("every check reports violations only in files that contain one of its triggers", () => {
    const misses: string[] = [];
    for (const set of FILE_SETS) {
      const checks = set.checks();
      for (const file of sources) {
        if (!set.includes(file.path)) continue;
        const prepared = set.prepare(file.path, file.contents);
        for (const check of checks) {
          if (matchingTriggers(file.contents, check.triggers).length > 0)
            continue;
          if (check.scan(set.violationFile(file.path), prepared).length > 0) {
            misses.push(`${check.id}: ${file.path}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  }, 120_000);
});
