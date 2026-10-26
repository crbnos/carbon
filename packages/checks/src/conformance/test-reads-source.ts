// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// A test that regexes source or migration text is a change detector: an
// applied migration never changes, a later one can redefine the object, and a
// reformat breaks it. packages/checks is the one place such a rule belongs,
// where it has a baseline and runs over every file.
const MESSAGE =
  "Tests do not read .sql/.ts/.tsx text; test the behaviour, or make the rule a conformance check in packages/checks (.claude/rules/testing.md)";

// A string literal naming source: `.sql`/`.ts`/`.tsx` at its end (a path or an
// extension filter), or the migrations directory.
const SOURCE_LITERAL =
  /["'`][^"'`\n]*\.(?:sql|tsx?)["'`]|["'`][^"'`\n]*\bmigrations\b[^"'`\n]*["'`]/;
// Directory walks filtered by a source extension: `endsWith(".ts")`,
// `/\.tsx?$/`, `new Set([".ts", ".tsx"])`.
const SOURCE_FILTER =
  /["'`]\.(?:sql|tsx?)["'`]|\/[^/\n]*\\\.(?:sql|tsx?)\??\$\//;
const TEMP_DIR = /\b(?:mkdtemp|mkdtempSync|tmpdir)\b/;
const RAW_IMPORT =
  /\bimport\b[^;]*?["'`][^"'`\n]*\.(?:sql|tsx?)\?raw["'`]|import\.meta\.glob\([^)]*\.(?:sql|tsx?)["'`][^)]*(?:\?raw|["']raw["'])/g;
const READ_CALL = /\b(readFileSync|readFile|readdirSync|readdir)\s*\(/g;
const DECLARATION =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:(?::[^=;]+)?=|\s+of\b)|\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;

const lineOf = (contents: string, index: number) =>
  contents.slice(0, index).split("\n").length;

/** Index just past the bracket that closes the one at `open`, skipping strings. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = text.indexOf(c, i + 1);
      i = end === -1 ? text.length : end;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** Text of a declaration's initializer or body: up to `;` at depth 0. */
function initializerAt(text: string, start: number): string {
  let depth = 0;
  const limit = Math.min(text.length, start + 4000);
  for (let i = start; i < limit; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = text.indexOf(c, i + 1);
      i = end === -1 ? limit : end;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth < 0) return text.slice(start, i);
    } else if (c === ";" && depth === 0) return text.slice(start, i);
  }
  return text.slice(start, limit);
}

/** What each declared name holds, for following a path through variables. */
function declarations(contents: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of contents.matchAll(DECLARATION)) {
    const name = match[1] ?? match[2];
    if (!name || out.has(name)) continue;
    const start = (match.index ?? 0) + match[0].length;
    out.set(
      name,
      match[2]
        ? contents.slice(start, closeOf(contents, contents.indexOf("{", start)))
        : initializerAt(contents, start)
    );
  }
  return out;
}

/** The text plus everything the names in it hold, a few levels deep. */
function context(text: string, decls: Map<string, string>): string {
  const seen = new Set<string>();
  let out = text;
  let frontier = text;
  for (let depth = 0; depth < 4 && frontier; depth++) {
    let next = "";
    for (const [name] of frontier.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const held = decls.get(name);
      if (held === undefined || seen.has(name)) continue;
      seen.add(name);
      next += `\n${held}`;
    }
    out += next;
    frontier = next;
  }
  return out;
}

export const testReadsSource: ConformanceCheck = {
  id: "test-reads-source",
  description: "Tests do not read source or migration text",
  provenance: {
    deprecates:
      "vitest files that readFileSync / ?raw-import .sql, .ts or .tsx and regex them",
    replacedBy:
      "behaviour tests, database tests, or a packages/checks conformance check (.claude/rules/testing.md)",
    since: "2026-10-25"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    const report = (index: number, snippet: string) =>
      violations.push({
        file,
        line: lineOf(contents, index),
        snippet: snippet.replace(/\s+/g, " ").slice(0, 120),
        message: MESSAGE
      });

    for (const match of contents.matchAll(RAW_IMPORT)) {
      report(match.index ?? 0, match[0]);
    }

    const decls = declarations(contents);
    // A local helper that reads (`const read = (p) => readFileSync(...)`) is
    // a read call too, so its call sites are judged by their arguments.
    const readers = [...decls]
      .filter(([, held]) => /\b(?:readFileSync|readFile)\s*\(/.test(held))
      .map(([name]) => name);
    const calls = [...contents.matchAll(READ_CALL)].map((m) => ({
      fn: m[1] as string,
      index: m.index ?? 0,
      open: (m.index ?? 0) + m[0].length - 1,
      helper: false
    }));
    for (const name of readers) {
      for (const m of contents.matchAll(
        new RegExp(`(?<![\\w$.])${name.replace("$", "\\$")}\\s*\\(`, "g")
      )) {
        const index = m.index ?? 0;
        // Skip the declaration itself (`function read(` / `const read = (`).
        if (
          /\bfunction\s+$/.test(contents.slice(Math.max(0, index - 10), index))
        )
          continue;
        calls.push({
          fn: name,
          index,
          open: index + m[0].length - 1,
          helper: true
        });
      }
    }

    const namesSourceAnywhere =
      (SOURCE_LITERAL.test(contents) || SOURCE_FILTER.test(contents)) &&
      !TEMP_DIR.test(contents);

    for (const { fn, index, open, helper } of calls.sort(
      (a, b) => a.index - b.index
    )) {
      const args = contents.slice(open, closeOf(contents, open));
      const held = context(args, decls);
      if (TEMP_DIR.test(held)) continue;
      const isListing = fn === "readdirSync" || fn === "readdir";
      const namesSource = isListing
        ? /["'`][^"'`\n]*\bmigrations\b/.test(held)
        : SOURCE_LITERAL.test(held);
      // The path is a callback or loop parameter, so the variables cannot say
      // what it reads; a file that names source paths and reads one it does
      // not name is reading those.
      // A helper's own read is judged inside it; its call sites only by
      // the path they pass.
      const unnamedRead =
        !isListing &&
        !helper &&
        namesSourceAnywhere &&
        !/["'`][^"'`\n]*\.\w+["'`]/.test(held);
      if (namesSource || unnamedRead) report(index, `${fn}${args}`);
    }
    return violations;
  }
};
