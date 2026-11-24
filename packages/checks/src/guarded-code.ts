// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Which race-protected code a diff touches. `guarded-code.json` maps each
 * function whose fix closed a race to the database tests that prove it; a
 * change there can reopen the race while every unit test stays green, so the
 * author is warned to keep those tests passing. A warning, not a gate: most
 * edits to a guarded function are safe, and only the database tests can say.
 *
 * Pure: the script (`scripts/guarded-code.ts`) reads git and the files.
 */

import { blankComments } from "./conformance/no-unscoped-kysely-write";
import { topLevelRegions } from "./conformance/row-writes";

export type GuardedEntry = {
  file: string;
  /** Top-level functions (or `Class.method`) of the file. */
  functions?: string[];
  /** A string on the line that opens a guarded block inside a large function. */
  markers?: string[];
  tests: string[];
};

/** A hunk of `git diff -U0`: the old and new line ranges it replaces. */
export type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
};

/** A named range of 1-based lines, inclusive. */
export type Span = { name: string; start: number; end: number };

export type Touch = {
  file: string;
  name: string;
  /** The line to annotate, in the new file. */
  line: number;
  tests: string[];
};

/** The registry, checked: a malformed entry would silently guard nothing. */
export function parseRegistry(json: string): GuardedEntry[] {
  const parsed = JSON.parse(json) as { guarded?: unknown };
  if (!Array.isArray(parsed.guarded)) {
    throw new Error("guarded-code.json: `guarded` must be an array");
  }
  return parsed.guarded.map((raw, i) => {
    const entry = raw as GuardedEntry;
    const names = [...(entry.functions ?? []), ...(entry.markers ?? [])];
    if (typeof entry.file !== "string" || names.length === 0) {
      throw new Error(
        `guarded-code.json entry ${i}: needs a file and at least one function or marker`
      );
    }
    if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
      throw new Error(
        `guarded-code.json entry ${i} (${entry.file}): names no test that proves its fix`
      );
    }
    return entry;
  });
}

/** The hunks per file of a `git diff -U0` (new path; `/dev/null` skipped). */
export function parseDiff(diff: string): Map<string, Hunk[]> {
  const out = new Map<string, Hunk[]>();
  let file: string | null = null;
  let oldFile: string | null = null;
  for (const line of diff.split("\n")) {
    const old = /^--- (?:a\/(.+)|\/dev\/null)$/.exec(line);
    if (old) {
      oldFile = old[1] ?? null;
      continue;
    }
    const next = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/.exec(line);
    if (next) {
      // A deleted file is reported under its old path.
      file = next[1] ?? oldFile;
      if (file && !out.has(file)) out.set(file, []);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      out.get(file)?.push({
        oldStart: Number(hunk[1]),
        oldCount: hunk[2] === undefined ? 1 : Number(hunk[2]),
        newStart: Number(hunk[3]),
        newCount: hunk[4] === undefined ? 1 : Number(hunk[4])
      });
    }
  }
  return out;
}

const COMMENT_LINE = /^\s*(?:\/\*\*?|\*|\/\/)/;

/**
 * The file's top-level declarations as line spans, each with the comment
 * block right above it (a hunk that edits a function's JSDoc edits that
 * function). A class is split into its methods, as the checks read it.
 */
export function functionSpans(source: string): Span[] {
  const lines = source.split("\n");
  const text = blankComments(source);
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  const spans = topLevelRegions(text).map((r) => ({
    name: r.name,
    start: lineAt(r.start),
    end: lines.length
  }));
  for (const span of spans) {
    while (span.start > 1 && COMMENT_LINE.test(lines[span.start - 2] ?? "")) {
      span.start--;
    }
  }
  for (let i = 0; i < spans.length - 1; i++) {
    const span = spans[i] as Span;
    span.end = Math.max(span.start, (spans[i + 1] as Span).start - 1);
  }
  return spans;
}

const indentOf = (line: string) => /^\s*/.exec(line)?.[0].length ?? 0;

/**
 * The block each line holding `marker` opens: from that line to the last line
 * before the first non-blank line indented less than it.
 */
export function markerSpans(source: string, marker: string): Span[] {
  const lines = source.split("\n");
  const spans: Span[] = [];
  lines.forEach((line, i) => {
    if (!line.includes(marker)) return;
    const indent = indentOf(line);
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] as string;
      if (next.trim() === "") continue;
      if (indentOf(next) < indent) break;
      end = j;
    }
    spans.push({ name: marker, start: i + 1, end: end + 1 });
  });
  return spans;
}

/** The changed lines of the hunks on one side: the new file's or the old's. */
function changedLines(hunks: Hunk[], side: "old" | "new"): number[] {
  return hunks.flatMap((h) => {
    const start = side === "new" ? h.newStart : h.oldStart;
    const count = side === "new" ? h.newCount : h.oldCount;
    return Array.from({ length: count }, (_, k) => start + k);
  });
}

function spansOf(entry: GuardedEntry, source: string): Span[] {
  const names = new Set(entry.functions ?? []);
  return [
    ...functionSpans(source).filter((s) => names.has(s.name)),
    ...(entry.markers ?? []).flatMap((m) => markerSpans(source, m))
  ];
}

/**
 * The guarded functions a file's hunks touch. A changed line counts in the
 * version it belongs to: an added or edited line against the new source, a
 * removed one against the old, so deleting lines from (or all of) a guarded
 * function is seen too. A source is null when the file does not exist on that
 * side; a name that is not in the file is skipped.
 */
export function touchedGuards(
  entry: GuardedEntry,
  hunks: Hunk[],
  newSource: string | null,
  oldSource: string | null
): Touch[] {
  const touches = new Map<string, Touch>();
  const touch = (name: string, line: number) => {
    if (!touches.has(name)) {
      touches.set(name, { file: entry.file, name, line, tests: entry.tests });
    }
  };
  const newSpans = newSource === null ? [] : spansOf(entry, newSource);
  for (const line of changedLines(hunks, "new")) {
    for (const span of newSpans) {
      if (line >= span.start && line <= span.end) touch(span.name, line);
    }
  }
  if (oldSource !== null) {
    const oldSpans = spansOf(entry, oldSource);
    for (const hunk of hunks) {
      for (const line of changedLines([hunk], "old")) {
        for (const span of oldSpans) {
          if (line < span.start || line > span.end) continue;
          // Annotate where the function now starts, or where the lines were.
          const now = newSpans.find((s) => s.name === span.name);
          touch(span.name, now?.start ?? Math.max(1, hunk.newStart));
        }
      }
    }
  }
  return [...touches.values()].sort((a, b) => a.line - b.line);
}

/** The GitHub Actions annotation for one touch. */
export function annotation(touch: Touch): string {
  return `::warning file=${touch.file},line=${touch.line}::${touch.name} is race-protected; ${touch.tests.join(", ")} prove its fix — keep them passing (Database tests job)`;
}
