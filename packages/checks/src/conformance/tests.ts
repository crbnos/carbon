// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Check,
  type ConformanceCheck,
  eachFile,
  fileCheck,
  type SourceFile,
  type Violation
} from "../check";
import { maskCommentsAndStrings } from "../sources/comments";
import { loadTestFiles } from "../sources/test-files";
import { lineOf } from "../sources/text";

// Tests: rules for how a test file is written (.claude/rules/testing.md). A
// test does not mock its own module's neighbours, does not read source or
// migration text, and does not return early and report a pass for a case it
// never ran.

// A test that mocks its own module's neighbours pins the wiring between them:
// it passes while the rule is wrong and fails when the code is reorganised.
// Package specifiers (`@carbon/...`, `node:...`) are not matched here.
const OWN_MODULE_MOCK =
  /\bvi\.(mock|doMock)\(\s*(?:import\(\s*)?(["'`])((?:\.{1,2}|~)\/[^"'`]*)\2/g;

export const testMocksOwnModule = fileCheck(loadTestFiles, {
  id: "test-mocks-own-module",
  description: "Tests do not vi.mock a first-party module by relative path",
  provenance: {
    deprecates:
      "vi.mock of ./, ../ or ~/ modules to reach the logic under test",
    replacedBy:
      "a pure function tested by value, or a database test (.claude/rules/testing.md)",
    since: "2026-10-25"
  },
  scan(file: string, contents: string): Violation[] {
    return [...contents.matchAll(OWN_MODULE_MOCK)].map((match) => ({
      file,
      line: lineOf(contents, match.index),
      snippet: `vi.${match[1]}("${match[3]}")`,
      message:
        "Do not mock our own modules; extract the decision into a pure function and test it by value (.claude/rules/testing.md → Mocks)"
    }));
  }
});

// A test that regexes source or migration text is a change detector: an
// applied migration never changes, a later one can redefine the object, and a
// reformat breaks it. packages/checks is the one place such a rule belongs,
// where it has a baseline and runs over every file.
const READS_SOURCE_MESSAGE =
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

/** Index just past the bracket that closes the one at `open`, skipping strings. */
function readsSourceCloseOf(text: string, open: number): number {
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
        ? contents.slice(
            start,
            readsSourceCloseOf(contents, contents.indexOf("{", start))
          )
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

export const testReadsSource = fileCheck(loadTestFiles, {
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
        message: READS_SOURCE_MESSAGE
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
      const args = contents.slice(open, readsSourceCloseOf(contents, open));
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
});

// vitest reports a case whose callback returns before asserting as PASSED:
// without a local stack the five cancel-job regressions went green unrun.
const SILENT_PASS_MESSAGE =
  "A test that returns early passes without running: use `it.skipIf(!x)(…)` / `databaseTest` so it reports skipped, or assert the value exists (.claude/rules/testing.md → Database tests)";

export const SHARED_TEST_FIXTURES_DIR = "apps/erp/test/database/fixtures";

export function loadSharedTestFixtures(root: string): SourceFile[] {
  return readdirSync(join(root, SHARED_TEST_FIXTURES_DIR))
    .filter((name) => /\.tsx?$/.test(name))
    .sort()
    .map((name) => {
      const file = `${SHARED_TEST_FIXTURES_DIR}/${name}`;
      return { file, contents: readFileSync(join(root, file), "utf8") };
    });
}

// Modifiers chained onto `it`/`test` that still declare a case. The ones in
// ARG_MODIFIERS take their own argument list before the case's.
const MODIFIERS = new Set([
  "only",
  "skip",
  "todo",
  "fails",
  "concurrent",
  "sequential",
  "each",
  "for",
  "skipIf",
  "runIf"
]);
const ARG_MODIFIERS = new Set(["each", "for", "skipIf", "runIf"]);

function closeOf(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return masked.length;
}

function skipSpace(masked: string, from: number): number {
  let i = from;
  while (i < masked.length && /\s/.test(masked[i] as string)) i++;
  return i;
}

/**
 * The `(` of the case's own arguments, past any modifier chain
 * (`it.skipIf(c)(`, `it.each(rows)(`); -1 for `it.extend(…)`, `test.describe`.
 */
function caseCallOpen(masked: string, start: number, name: string): number {
  let i = start + name.length;
  for (;;) {
    i = skipSpace(masked, i);
    const c = masked[i];
    if (c === "(") return i;
    if (c !== ".") return -1;
    const modifier = /^\.\s*([A-Za-z_$][\w$]*)/.exec(masked.slice(i));
    if (!modifier || !MODIFIERS.has(modifier[1] as string)) return -1;
    i = skipSpace(masked, i + modifier[0].length);
    if (!ARG_MODIFIERS.has(modifier[1] as string)) continue;
    // `it.each\`table\`` takes a template; the rest take a call.
    if (masked[i] === "`") {
      const end = masked.indexOf("`", i + 1);
      if (end === -1) return -1;
      i = end + 1;
    } else if (masked[i] === "(") {
      i = closeOf(masked, i) + 1;
    } else return -1;
  }
}

/** Top-level arguments of the call whose `(` is at `open`: [start, end). */
function argumentsOf(masked: string, open: number): [number, number][] {
  const close = closeOf(masked, open);
  const out: [number, number][] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push([from, i]);
      from = i + 1;
    }
  }
  out.push([from, close]);
  return out;
}

/** The `{` of a block-bodied function expression filling [start, end), or -1. */
function functionBodyOpen(masked: string, start: number, end: number): number {
  let i = skipSpace(masked, start);
  if (/^async\b/.test(masked.slice(i, end))) i = skipSpace(masked, i + 5);
  if (/^function\b/.test(masked.slice(i, end))) {
    const params = masked.indexOf("(", i);
    if (params === -1 || params >= end) return -1;
    const brace = skipSpace(masked, closeOf(masked, params) + 1);
    return masked[brace] === "{" ? brace : -1;
  }
  if (masked[i] === "(") i = closeOf(masked, i) + 1;
  else {
    const param = /^[A-Za-z_$][\w$]*/.exec(masked.slice(i, end));
    if (!param) return -1;
    i += param[0].length;
  }
  const arrow = /^\s*(?::[^=]*?)?=>\s*/.exec(masked.slice(i, end));
  if (!arrow) return -1;
  const brace = i + arrow[0].length;
  return masked[brace] === "{" ? brace : -1;
}

/**
 * `if`s at the body's top level, or nested only in `try` / `catch` / `finally`
 * blocks (a database test that releases its connection).
 */
function topLevelIfs(masked: string, open: number, close: number): number[] {
  const out: number[] = [];
  // One entry per open bracket: whether it opens a try, catch or finally block.
  const stack: boolean[] = [];
  for (let i = open + 1; i < close; i++) {
    const c = masked[i];
    if (c === "{" || c === "(" || c === "[") {
      let transparent = false;
      if (c === "{") {
        let j = i - 1;
        while (j > open && /\s/.test(masked[j] as string)) j--;
        const word = masked.slice(Math.max(open + 1, j - 6), j + 1);
        if (/(?<![\w$])(?:try|finally)$/.test(word)) transparent = true;
        else if (masked[j] === ")") {
          const paren = openOf(masked, j);
          transparent = /(?<![\w$])catch\s*$/.test(
            masked.slice(Math.max(open + 1, paren - 8), paren)
          );
        }
      }
      stack.push(transparent);
    } else if (c === "}" || c === ")" || c === "]") stack.pop();
    else if (
      c === "i" &&
      stack.every(Boolean) &&
      /^if\s*\(/.test(masked.slice(i, i + 8)) &&
      !/[\w$.]/.test(masked[i - 1] ?? "")
    ) {
      out.push(i);
    }
  }
  return out;
}

function openOf(masked: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    const c = masked[i];
    if (c === ")") depth++;
    else if (c === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return 0;
}

function splitTopLevel(text: string, operator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && text.startsWith(operator, i)) {
      parts.push(text.slice(from, i));
      from = i + operator.length;
      i += operator.length - 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** A test that the thing a case needs is missing: `!x`, `x == null`, `!x.length`. */
function isMissingTest(operand: string): boolean {
  const o = operand.trim();
  return (
    /^!(?!=)/.test(o) ||
    /[=!]==?\s*(?:null|undefined)\b/.test(o) ||
    /^(?:null|undefined)\s*[=!]==?/.test(o) ||
    /\btypeof\s+[\w$.]+\s*===?\s*["']undefined["']/.test(o) ||
    /\.length\s*===?\s*0$/.test(o)
  );
}

function isMissingCondition(condition: string): boolean {
  return splitTopLevel(condition, "||")
    .flatMap((part) => splitTopLevel(part, "&&"))
    .some(isMissingTest);
}

function bareReturnEnd(masked: string, from: number): number {
  const statement = /^return[ \t]*(?:;|(?=\r?\n|\}|$))/.exec(
    masked.slice(from)
  );
  if (statement) return from + statement[0].length;
  const block = /^\{\s*return\s*;?\s*\}/.exec(masked.slice(from));
  return block ? from + block[0].length : -1;
}

/**
 * `expect(result.ok).toBe(true); if (!result.ok) return;` narrows a type: the
 * assertion just before it throws first, so the return is never reached in a
 * passing test.
 */
function narrowsJustAsserted(
  masked: string,
  at: number,
  condition: string
): boolean {
  const negated = /^\s*!\s*([\w$.?![\]]+)\s*$/.exec(condition);
  if (!negated) return false;
  const subject = (negated[1] as string).replace(/[.?![\]$]/g, "\\$&");
  return new RegExp(`\\bexpect\\(\\s*${subject}\\s*\\)[^;]*;\\s*$`).test(
    masked.slice(Math.max(0, at - 400), at)
  );
}

/** Names declared here as `(name, fn)` wrappers: their body declares a case. */
function localWrappers(masked: string, known: readonly string[]): string[] {
  const found = new Set<string>();
  const declaration =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?=(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>))|\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const bodies: [string, string][] = [];
  for (const match of masked.matchAll(declaration)) {
    const name = (match[1] ?? match[2]) as string;
    const start = (match.index ?? 0) + match[0].length;
    const brace = match[2]
      ? masked.indexOf("{", closeOf(masked, start - 1))
      : -1;
    const end = match[2] ? closeOf(masked, brace) : statementEnd(masked, start);
    bodies.push([name, masked.slice(start, end)]);
  }
  // A wrapper may wrap another wrapper, so repeat until nothing new is found.
  for (let grew = true; grew; ) {
    grew = false;
    const callees = calleePattern([...known, ...found]);
    for (const [name, body] of bodies) {
      if (found.has(name) || known.includes(name)) continue;
      callees.lastIndex = 0;
      for (const call of body.matchAll(callees)) {
        if (caseCallOpen(body, call.index ?? 0, call[1] as string) !== -1) {
          found.add(name);
          grew = true;
          break;
        }
      }
    }
  }
  return [...found];
}

function statementEnd(masked: string, start: number): number {
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth < 0) return i;
    } else if (depth === 0 && (c === ";" || masked.startsWith("\n\n", i)))
      return i;
  }
  return masked.length;
}

function calleePattern(names: string[]): RegExp {
  const alternatives = ["it", "test", ...names].map((n) =>
    n.replace(/\$/g, "\\$")
  );
  return new RegExp(`(?<![\\w$.])(${alternatives.join("|")})\\b`, "g");
}

/**
 * The `(name, fn)` wrappers the shared fixtures export, found to a fixpoint
 * across files so a wrapper of another file's wrapper counts.
 */
export function sharedTestWrappers(fixtures: SourceFile[]): string[] {
  const masked = fixtures.map(({ contents }) =>
    maskCommentsAndStrings(contents)
  );
  const found: string[] = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const text of masked) {
      for (const name of localWrappers(text, found)) {
        const exported = new RegExp(
          `\\bexport\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${name.replace(/\$/g, "\\$")}\\b`
        );
        if (exported.test(text)) {
          found.push(name);
          grew = true;
        }
      }
    }
  }
  return found;
}

const ABOUT = {
  id: "no-silent-test-pass",
  description:
    "A test case does not return early when what it needs is missing; it skips",
  provenance: {
    deprecates:
      "`if (!client) return;` at the top of a test callback, which reports the case passed without running it",
    replacedBy:
      "`it.skipIf(!client)(…)`, `databaseTest` or `postgrestTest` (.claude/rules/testing.md → Database tests)",
    since: "2026-11-23"
  }
};

/**
 * Fails a bare `return` guarded by a test that a value is missing: `!x`,
 * `x == null`, `x === undefined`, `x.length === 0`, alone or in an `||`/`&&`
 * chain. Both `if (…) return;` and `if (…) { return; }` count. The `if` must sit
 * at the top level of a test case's callback, or in a `try`/`catch`/`finally`
 * block there.
 *
 * The incident: `cancel-job.test.ts` wrapped its cases in `cancelTest`, which
 * ran `databaseTest(name, async () => { if (!caller) return; … })`. With no
 * local stack, all five cases passed without running.
 *
 * A test case is one of these:
 * - `it(` or `test(` with any modifier chain (`.only`, `.concurrent`,
 *   `.each(…)(`, `.skipIf(…)(`).
 * - A `(name, fn)` wrapper that `apps/erp/test/database/fixtures/` exports
 *   (`databaseTest`, `postgrestTest`). `sharedTestWrappers` finds them, so a new
 *   wrapper needs no list entry.
 * - A `(name, fn)` wrapper declared in the same file whose body declares a
 *   case. The search repeats until nothing new is found, so a wrapper of a
 *   wrapper counts.
 *
 * Hooks, `describe` and functions nested inside the callback are not read.
 */
export function noSilentTestPass(
  sharedWrappers: readonly string[]
): ConformanceCheck {
  return {
    ...ABOUT,
    scan(file: string, contents: string): Violation[] {
      const masked = maskCommentsAndStrings(contents);
      const wrappers = [
        ...sharedWrappers,
        ...localWrappers(masked, sharedWrappers)
      ];
      const violations: Violation[] = [];
      const seen = new Set<number>();
      for (const call of masked.matchAll(calleePattern(wrappers))) {
        const start = call.index ?? 0;
        // The wrapper's own declaration is not a call of it.
        if (/\bfunction\s+$/.test(masked.slice(Math.max(0, start - 12), start)))
          continue;
        const open = caseCallOpen(masked, start, call[1] as string);
        if (open === -1) continue;
        for (const [from, to] of argumentsOf(masked, open)) {
          const body = functionBodyOpen(masked, from, to);
          if (body === -1) continue;
          for (const at of topLevelIfs(masked, body, closeOf(masked, body))) {
            const conditionOpen = masked.indexOf("(", at);
            const conditionClose = closeOf(masked, conditionOpen);
            const condition = contents.slice(conditionOpen + 1, conditionClose);
            if (
              !isMissingCondition(condition) ||
              narrowsJustAsserted(masked, at, condition)
            )
              continue;
            const end = bareReturnEnd(
              masked,
              skipSpace(masked, conditionClose + 1)
            );
            if (end === -1 || seen.has(at)) continue;
            seen.add(at);
            violations.push({
              file,
              line: lineOf(contents, at),
              snippet: contents.slice(at, end).replace(/\s+/g, " "),
              message: SILENT_PASS_MESSAGE
            });
          }
        }
      }
      return violations.sort((a, b) => a.line - b.line);
    }
  };
}

export const noSilentTestPassCheck: Check = {
  ...ABOUT,
  find: (repo) =>
    eachFile(
      repo.read(loadTestFiles),
      noSilentTestPass(sharedTestWrappers(repo.read(loadSharedTestFixtures)))
        .scan
    )
};

/** The tests checks, in the order they are written above. */
export const checks: Check[] = [
  testMocksOwnModule,
  testReadsSource,
  noSilentTestPassCheck
];
