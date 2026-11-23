// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import { maskCommentsAndStrings } from "./no-default-on-effects";

/**
 * supabase-js never throws: every query resolves to `{ data, error, count }`,
 * and a failed one has `data: null`. Code that reads `data` without `error`
 * turns a failed read into "none", and "none" usually means "allowed" or
 * "nothing to do". The consolidated ledger drill-down read every company when
 * its company-group read failed (cfdc4f9299), a price-list export ended early
 * instead of failing (b399972472), an approval check read a failed query as
 * "nothing pending" (c0b85077ee), and an RFQ-line mapping upsert whose result
 * was never bound failed on every call, silently (22c9b98508).
 *
 * Four shapes are failed, each on an awaited supabase-js call — a chain with a
 * `.from(…)`, `.rpc(…)` or `.functions.invoke(…)` member call (so
 * `.storage.from(…)` too), whose head is not a PascalCase global like
 * `Array.from`, and which has no Kysely `.execute…()`/`.compile()`:
 *
 *  1. an object destructure that binds `data` or `count` but not `error`
 *     (a `...rest` element counts as binding it);
 *  2. an awaited `.from(…)` write (`insert`/`update`/`upsert`/`delete`) used
 *     as a bare statement, so its result goes nowhere;
 *  3. `(await …).data` / `.count` read straight off the call;
 *  4. `const r = await …` whose block reads `r.data`/`r.count` but never
 *     `r.error`, and never hands `r` itself on (returned, passed, spread) —
 *     whoever receives it may check the error.
 *
 * A bound `error` that is never read is left to Biome (`noUnusedVariables`
 * fails it); what a read DOES with it (log and carry on) is beyond a text
 * check. A builder kept in a variable (`const q = client.from(…); await q`)
 * and `Promise.all` results are not followed.
 */

const MESSAGE =
  "Check `error` before reading `data`: a failed supabase-js read must not mean 'none'. Bind `error` and `if (error) return/throw` it — and bind a write's result and check it.";

/** Member calls that make a chain a supabase-js request. */
const QUERY_CALLS = new Set(["from", "rpc"]);
const WRITE_CALLS = new Set(["insert", "update", "upsert", "delete"]);
/** Kysely builders also have `.from(` (`updateTable(…).from(…)`). */
const KYSELY_CALLS = /^(?:execute\w*|compile|stream)$/;

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

type Segment = { name: string; call: boolean };
type Chain = { head: string; segments: Segment[]; end: number };

function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i] as string)) i++;
  return i;
}

function skipWsBack(text: string, i: number): number {
  while (i >= 0 && /\s/.test(text[i] as string)) i--;
  return i;
}

/** Index of the bracket closing the one at `open` (strings already masked). */
function matchForward(text: string, open: number): number {
  const opener = text[open] as string;
  const closer = { "(": ")", "[": "]", "{": "}", "<": ">" }[opener];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the bracket opening the one that closes at `close`. */
function matchBack(text: string, close: number): number {
  const closer = text[close] as string;
  const opener = { ")": "(", "]": "[", "}": "{" }[closer];
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === closer) depth++;
    else if (text[i] === opener) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function readIdent(text: string, i: number): number {
  if (!IDENT_START.test(text[i] ?? "")) return i;
  let end = i + 1;
  while (end < text.length && IDENT_PART.test(text[end] as string)) end++;
  return end;
}

/**
 * The member chain starting at `i`: an identifier or parenthesised head, then
 * `.name`, `?.name`, `(…)`, `[…]`, `!` and `<T>(…)` segments. Ends at the first
 * character that continues no chain.
 */
function parseChain(text: string, start: number): Chain | null {
  let i = skipWs(text, start);
  let head: string;
  if (text[i] === "(") {
    const close = matchForward(text, i);
    if (close === -1) return null;
    head = "(";
    i = close + 1;
  } else {
    const end = readIdent(text, i);
    if (end === i) return null;
    head = text.slice(i, end);
    i = end;
  }
  const segments: Segment[] = [];
  for (;;) {
    const k = skipWs(text, i);
    const c = text[k];
    if (c === "!" && text[k + 1] !== "=") {
      i = k + 1;
      continue;
    }
    let dot = -1;
    if (c === ".") dot = k + 1;
    else if (c === "?" && text[k + 1] === ".") dot = k + 2;
    if (dot !== -1) {
      const at = skipWs(text, dot);
      if (text[at] === "(" || text[at] === "[") {
        i = at;
        continue;
      }
      const end = readIdent(text, at);
      if (end === at) return { head, segments, end: k };
      let next = skipWs(text, end);
      if (text[next] === "<") {
        const close = matchForward(text, next);
        const after = close === -1 ? -1 : skipWs(text, close + 1);
        if (after !== -1 && text[after] === "(") next = after;
      }
      if (text[next] === "(") {
        const close = matchForward(text, next);
        if (close === -1) return null;
        segments.push({ name: text.slice(at, end), call: true });
        i = close + 1;
      } else {
        segments.push({ name: text.slice(at, end), call: false });
        i = end;
      }
      continue;
    }
    if (c === "(" || c === "[") {
      const close = matchForward(text, k);
      if (close === -1) return null;
      i = close + 1;
      continue;
    }
    return { head, segments, end: i };
  }
}

/** Whether the chain is a supabase-js request, and whether it is a `.from` write. */
function classify(chain: Chain): { query: boolean; write: boolean } {
  const none = { query: false, write: false };
  if (/^[A-Z]/.test(chain.head)) return none;
  const { segments } = chain;
  if (segments.some((s) => s.call && KYSELY_CALLS.test(s.name))) return none;
  const fromAt = segments.findIndex((s) => s.call && s.name === "from");
  const query =
    segments.some((s) => s.call && QUERY_CALLS.has(s.name)) ||
    segments.some(
      (s, n) =>
        !s.call &&
        s.name === "functions" &&
        segments[n + 1]?.call === true &&
        segments[n + 1]?.name === "invoke"
    );
  const write =
    fromAt !== -1 &&
    segments.slice(fromAt + 1).some((s) => s.call && WRITE_CALLS.has(s.name));
  return { query, write };
}

/** Top-level property keys of the object pattern `{…}` spanning open..close. */
function patternKeys(text: string, open: number, close: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let expectKey = true;
  for (let i = open + 1; i < close; i++) {
    const c = text[i] as string;
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) expectKey = true;
    else if (expectKey && depth === 0 && !/\s/.test(c)) {
      expectKey = false;
      if (text.startsWith("...", i)) {
        keys.push("...");
        continue;
      }
      const end = readIdent(text, i);
      if (end > i) keys.push(text.slice(i, end));
    }
  }
  return keys;
}

/**
 * The object pattern a `= await` at `eq` assigns to (`const { … } =`,
 * `({ … } =`), as its open/close indexes, or null for any other target.
 */
function destructureBefore(
  text: string,
  eq: number
): { open: number; close: number } | null {
  const close = skipWsBack(text, eq - 1);
  if (text[close] !== "}") return null;
  const open = matchBack(text, close);
  if (open === -1) return null;
  const before = skipWsBack(text, open - 1);
  if (text[before] === "(") return { open, close };
  const keyword = text.slice(wordStart(text, before), before + 1);
  return ["const", "let", "var"].includes(keyword) ? { open, close } : null;
}

/** `const name =` / `let name =` before the `=` at `eq`. */
function nameBefore(
  text: string,
  eq: number
): { name: string; start: number } | null {
  const end = skipWsBack(text, eq - 1);
  if (!IDENT_PART.test(text[end] ?? "")) return null;
  const start = wordStart(text, end);
  const keyEnd = skipWsBack(text, start - 1);
  const keyStart = wordStart(text, keyEnd);
  const keyword = text.slice(keyStart, keyEnd + 1);
  if (keyword !== "const" && keyword !== "let") return null;
  return { name: text.slice(start, end + 1), start: keyStart };
}

/** Start of the identifier whose last character is at `end`. */
function wordStart(text: string, end: number): number {
  let start = end;
  while (start > 0 && IDENT_PART.test(text[start - 1] as string)) start--;
  return start;
}

/**
 * Whether the rest of the enclosing block reads `name.data`/`name.count` while
 * never touching `name.error` nor handing `name` itself on (returned, passed,
 * spread, reassigned) — any of which may check the error elsewhere.
 */
function readsDataNotError(
  text: string,
  name: string,
  declaredAt: number,
  from: number
): boolean {
  let open = declaredAt;
  for (let depth = 0; open >= 0; open--) {
    if (text[open] === "}") depth++;
    else if (text[open] === "{") {
      if (depth === 0) break;
      depth--;
    }
  }
  const close = open < 0 ? text.length : matchForward(text, open);
  const body = text.slice(from, close === -1 ? text.length : close);
  const use = new RegExp(
    `(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`,
    "g"
  );
  let readsResult = false;
  for (const m of body.matchAll(use)) {
    const at = m.index ?? 0;
    // `other.name` is another object's property; `...name` hands it on.
    if (body[at - 1] === "." && body.slice(at - 3, at) !== "...") continue;
    const after = body
      .slice(at + name.length)
      .match(/^\s*!?\s*\??\.\s*([\w$]+)/);
    const member = after?.[1];
    if (!member) return false;
    if (member === "error") return false;
    if (member === "data" || member === "count") readsResult = true;
  }
  return readsResult;
}

/** Whether the `await` at `at` begins a statement. */
function startsStatement(text: string, at: number): boolean {
  const prev = skipWsBack(text, at - 1);
  if (prev < 0) return true;
  const c = text[prev];
  if (c === ";" || c === "{" || c === "}") return true;
  if (text.slice(wordStart(text, prev), prev + 1) === "else") return true;
  if (c === ")") {
    const open = matchBack(text, prev);
    const kw = text.slice(Math.max(0, open - 7), open).trimEnd();
    return /(?:^|[^\w$])(?:if|for|while)$/.test(kw);
  }
  return false;
}

/** Whether the statement ends where the chain does (`;`, `}`, or a new line). */
function endsStatement(text: string, end: number): boolean {
  const next = skipWs(text, end);
  if (next >= text.length) return true;
  const c = text[next];
  if (c === ";" || c === "}") return true;
  return text.slice(end, next).includes("\n") && /[\w$]/.test(c as string);
}

function snippetOf(contents: string, from: number, to: number): string {
  const text = contents
    .slice(from, to)
    .replace(/\s+/g, " ")
    .replace(/ (\??\.)/g, "$1")
    .trim();
  return text.length <= 120 ? text : `${text.slice(0, 117)}...`;
}

/** End of the chain's first `.from(…)` / `.rpc(…)` / `.invoke(…)` call. */
function requestEnd(text: string, from: number): number {
  const re = /\.\s*(?:from|rpc|invoke)\s*\(/g;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return from;
  const close = matchForward(text, m.index + m[0].length - 1);
  return close === -1 ? m.index + m[0].length : close + 1;
}

export const noDiscardedQueryError: ConformanceCheck = {
  id: "no-discarded-query-error",
  description:
    "A supabase-js result is never read without its error: no `{ data }` destructure without `error`, no `(await …).data`, no `r.data` from a result whose `r.error` is never read, and no awaited write whose result is dropped.",
  provenance: {
    deprecates:
      "`const { data } = await client.from(…)`, `result.data` with no `result.error`, and unbound awaited writes, which read a failed query as 'none' (cfdc4f9299, b399972472, c0b85077ee, 22c9b98508)",
    replacedBy:
      "`const { data, error } = await …; if (error) …`, and every write's result bound and checked"
  },
  scan(file, contents) {
    if (!/\bawait\b/.test(contents)) return [];
    if (!/\.\s*(?:from|rpc|invoke)\s*\(/.test(contents)) return [];
    const text = maskCommentsAndStrings(contents);
    const violations: Violation[] = [];
    const report = (at: number, snippet: string) =>
      violations.push({
        file,
        line: contents.slice(0, at).split("\n").length,
        snippet,
        message: MESSAGE
      });

    for (const m of text.matchAll(/\bawait\b/g)) {
      const at = m.index ?? 0;
      if (at > 0 && /[\w$.]/.test(text[at - 1] as string)) continue;
      const chain = parseChain(text, at + m[0].length);
      if (!chain) continue;
      const { query, write } = classify(chain);
      if (!query) continue;
      const request = requestEnd(text, at);

      const prev = skipWsBack(text, at - 1);
      if (text[prev] === "=" && !/[=!<>]/.test(text[prev - 1] ?? "")) {
        const bound = nameBefore(text, prev);
        if (bound) {
          if (readsDataNotError(text, bound.name, bound.start, chain.end)) {
            report(bound.start, snippetOf(contents, bound.start, request));
          }
          continue;
        }
        const pattern = destructureBefore(text, prev);
        if (!pattern) continue;
        const keys = patternKeys(text, pattern.open, pattern.close);
        const readsResult = keys.includes("data") || keys.includes("count");
        if (readsResult && !keys.includes("error") && !keys.includes("...")) {
          const before = skipWsBack(text, pattern.open - 1);
          const from =
            text[before] === "(" ? pattern.open : wordStart(text, before);
          report(from, snippetOf(contents, from, request));
        }
        continue;
      }

      if (text[prev] === "(") {
        const close = skipWs(text, chain.end);
        if (text[close] !== ")") continue;
        const member = text
          .slice(close + 1)
          .match(/^\s*\??\.\s*(data|count)\b/);
        if (member) {
          report(at, `(${snippetOf(contents, at, request)}…).${member[1]}`);
        }
        continue;
      }

      if (
        write &&
        startsStatement(text, at) &&
        endsStatement(text, chain.end)
      ) {
        const verb = chain.segments.find(
          (s) => s.call && WRITE_CALLS.has(s.name)
        );
        report(at, `${snippetOf(contents, at, request)}.${verb?.name}(`);
      }
    }
    return violations;
  }
};
