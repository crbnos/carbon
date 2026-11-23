// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, SourceFile, Violation } from "../check";
import { maskCommentsAndStrings } from "./no-default-on-effects";

// vitest reports a case whose callback returns before asserting as PASSED:
// without a local stack the five cancel-job regressions went green unrun.
const MESSAGE =
  "A test that returns early passes without running: use `it.skipIf(!x)(…)` / `databaseTest` so it reports skipped, or assert the value exists (.claude/rules/testing.md → Database tests)";

export const SHARED_TEST_FIXTURES_DIR = "apps/erp/test/database/fixtures";

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

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

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

export function noSilentTestPass(
  sharedWrappers: readonly string[]
): ConformanceCheck {
  return {
    id: "no-silent-test-pass",
    description:
      "A test case does not return early when what it needs is missing; it skips",
    provenance: {
      deprecates:
        "`if (!client) return;` at the top of a test callback, which reports the case passed without running it",
      replacedBy:
        "`it.skipIf(!client)(…)`, `databaseTest` or `postgrestTest` (.claude/rules/testing.md → Database tests)",
      since: "2026-11-23"
    },
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
              message: MESSAGE
            });
          }
        }
      }
      return violations.sort((a, b) => a.line - b.line);
    }
  };
}
