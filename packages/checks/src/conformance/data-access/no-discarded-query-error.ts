// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, type Violation } from "../../check";
import { maskCommentsAndStrings } from "../../sources/comments";
import { typescript } from "../../sources/inputs";
import { skipSpace } from "../../sources/row-writes";
import { IDENT_PART, IDENT_START, lineOf } from "../../sources/text";

// A supabase-js result is never read without its `error`. The incidents:
// - the consolidated ledger drill-down read every company when its
//   company-group read failed (cfdc4f9299);
// - a price-list export ended early instead of failing (b399972472);
// - an approval check read a failed query as "nothing pending" (c0b85077ee);
// - the RFQ-line `customerPartToItem` upsert failed on every call, because its
//   result was never bound (22c9b98508).
//
// It reads an awaited chain that calls `.from(…)`, `.rpc(…)` or
// `.functions.invoke(…)`, so `.storage.from(…)` counts too. A chain whose head
// is PascalCase (`Array.from`) is skipped. So is a chain with a Kysely
// `.execute…()`, `.compile()` or `.stream()`. It fails four shapes:
// 1. A destructure that binds `data` or `count` and not `error`. A `...rest`
//    counts as binding `error`.
// 2. `(await …).data` or `(await …).count`.
// 3. `const r = await …` when the enclosing block reads `r.data` or `r.count`,
//    never reads `r.error`, and never hands `r` on (returns, passes, spreads or
//    reassigns it). The receiver may check the error.
// 4. An awaited `.from(…).insert/update/upsert/delete(…)` used as a bare
//    statement.
//
// The fix: bind `error`, and return or throw on it. A best-effort write still
// binds its result and logs the error.
//
// Left to others: a bound `error` that is never read fails oxlint's
// `no-unused-vars`. What the code does with the error is beyond a text
// check.
//
// Known gaps: a query builder kept in a variable (`const q = client.from(…);
// await q`, the second half of b399972472), `Promise.all` results, and the
// `{ data }` result of a service function (`await getX(client)`).
//
// There is no allow comment: the baseline holds each deliberate exception.
// Two hits with the same snippet in one file share one baseline key.
//
// It reads browser code too. About a quarter of the hits were there, and the
// sampled ones were real: a notes autosave that dropped a failed update, and a
// picker that showed an empty list on a failed read.
export const noDiscardedQueryError = defineCheck({
  files: typescript,
  id: "no-discarded-query-error",
  description:
    "A supabase-js result is never read without its error: no `{ data }` destructure without `error`, no `(await …).data`, no `r.data` from a result whose `r.error` is never read, and no awaited write whose result is dropped.",
  provenance: {
    deprecates:
      "`const { data } = await client.from(…)`, `result.data` with no `result.error`, and unbound awaited writes, which read a failed query as 'none' (cfdc4f9299, b399972472, c0b85077ee, 22c9b98508)",
    replacedBy:
      "`const { data, error } = await …; if (error) …`, and every write's result bound and checked",
    incidents: ["cfdc4f9299", "b399972472", "c0b85077ee", "22c9b98508"]
  },
  rule() {
    const discardedQueryMessage =
      "Check `error` before reading `data`: a failed supabase-js read must not mean 'none'. Bind `error` and `if (error) return/throw` it — and bind a write's result and check it.";

    const requestCall = /\.\s*(?:from|rpc|invoke)\s*(?:<[^()]*>\s*)?\(/;
    const queryCalls = new Set(["from", "rpc"]);
    const declarations = new Set(["const", "let", "var"]);
    const writeCalls = new Set(["insert", "update", "upsert", "delete"]);
    /** Kysely builders also have `.from(` (`updateTable(…).from(…)`). */
    const kyselyCalls = /^(?:execute\w*|compile|stream)$/;

    type Segment = { name: string; call: boolean };
    type Chain = { head: string; segments: Segment[]; end: number };

    function skipSpaceBack(text: string, i: number): number {
      while (i >= 0 && /\s/.test(text.charAt(i))) i--;
      return i;
    }

    /** Assumes comments and strings are masked. */
    function matchForward(text: string, open: number): number {
      const opener = text.charAt(open);
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

    function matchBack(text: string, close: number): number {
      const closer = text.charAt(close);
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
      while (end < text.length && IDENT_PART.test(text.charAt(end))) end++;
      return end;
    }

    /**
     * The member chain starting at `i`: an identifier or parenthesised head, then
     * `.name`, `?.name`, `(…)`, `[…]`, `!` and `<T>(…)` segments. Ends at the first
     * character that continues no chain.
     */
    function parseChain(text: string, start: number): Chain | null {
      let i = skipSpace(text, start);
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
        const k = skipSpace(text, i);
        const c = text[k];
        if (c === "!" && text[k + 1] !== "=") {
          i = k + 1;
          continue;
        }
        let dot = -1;
        if (c === ".") dot = k + 1;
        else if (c === "?" && text[k + 1] === ".") dot = k + 2;
        if (dot !== -1) {
          const at = skipSpace(text, dot);
          if (text[at] === "(" || text[at] === "[") {
            i = at;
            continue;
          }
          const end = readIdent(text, at);
          if (end === at) return { head, segments, end: k };
          let next = skipSpace(text, end);
          if (text[next] === "<") {
            const close = matchForward(text, next);
            const after = close === -1 ? -1 : skipSpace(text, close + 1);
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

    function classify(chain: Chain): { query: boolean; write: boolean } {
      const none = { query: false, write: false };
      if (/^[A-Z]/.test(chain.head)) return none;
      const { segments } = chain;
      if (segments.some((s) => s.call && kyselyCalls.test(s.name))) return none;
      const fromAt = segments.findIndex((s) => s.call && s.name === "from");
      const query =
        segments.some((s) => s.call && queryCalls.has(s.name)) ||
        segments.some(
          (s, n) =>
            !s.call &&
            s.name === "functions" &&
            segments[n + 1]?.call === true &&
            segments[n + 1]?.name === "invoke"
        );
      const write =
        fromAt !== -1 &&
        segments
          .slice(fromAt + 1)
          .some((s) => s.call && writeCalls.has(s.name));
      return { query, write };
    }

    /** Top-level keys only; a rest element yields `...`. */
    function patternKeys(text: string, open: number, close: number): string[] {
      const keys: string[] = [];
      let depth = 0;
      let expectKey = true;
      for (let i = open + 1; i < close; i++) {
        const c = text.charAt(i);
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

    function destructureBefore(
      text: string,
      eq: number
    ): { open: number; close: number } | null {
      const close = skipSpaceBack(text, eq - 1);
      if (text[close] !== "}") return null;
      const open = matchBack(text, close);
      if (open === -1) return null;
      const before = skipSpaceBack(text, open - 1);
      if (text[before] === "(") return { open, close };
      const keyword = text.slice(wordStart(text, before), before + 1);
      return ["const", "let", "var"].includes(keyword) ? { open, close } : null;
    }

    type Bound = { name: string; start: number };

    /** `const name =`, `name =` starting a statement, or `const name: Type =`. */
    function nameBefore(text: string, eq: number): Bound | null {
      const end = skipSpaceBack(text, eq - 1);
      const declared = declaredName(text, end);
      if (declared) return declared;
      if (IDENT_PART.test(text[end] ?? "")) {
        const start = wordStart(text, end);
        if (startsStatement(text, start)) {
          return { name: text.slice(start, end + 1), start };
        }
      }
      const colon = annotationColon(text, end);
      if (colon === -1) return null;
      return declaredName(text, skipSpaceBack(text, colon - 1));
    }

    function declaredName(text: string, end: number): Bound | null {
      if (!IDENT_PART.test(text[end] ?? "")) return null;
      const start = wordStart(text, end);
      const keyEnd = skipSpaceBack(text, start - 1);
      const keyStart = wordStart(text, keyEnd);
      if (!declarations.has(text.slice(keyStart, keyEnd + 1))) return null;
      return { name: text.slice(start, end + 1), start: keyStart };
    }

    /** The `:` opening a type annotation that ends at `end`, or -1. */
    function annotationColon(text: string, end: number): number {
      let depth = 0;
      for (let i = end; i >= 0; i--) {
        const c = text.charAt(i);
        if (")]}>".includes(c)) depth++;
        if ("([{<".includes(c)) depth--;
        if (depth < 0) return -1;
        if (depth === 0 && c === ":") return i;
        if (depth === 0 && c === ";") return -1;
      }
      return -1;
    }

    function wordStart(text: string, end: number): number {
      let start = end;
      while (start > 0 && IDENT_PART.test(text.charAt(start - 1))) start--;
      return start;
    }

    /** False once `name` is handed on (returned, passed, spread, reassigned): the receiver may check the error. */
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

    function startsStatement(text: string, at: number): boolean {
      const prev = skipSpaceBack(text, at - 1);
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

    function endsStatement(text: string, end: number): boolean {
      const next = skipSpace(text, end);
      if (next >= text.length) return true;
      const c = text[next];
      if (c === ";" || c === "}") return true;
      return text.slice(end, next).includes("\n") && /[\w$]/.test(c ?? "");
    }

    function snippetOf(contents: string, from: number, to: number): string {
      const text = contents
        .slice(from, to)
        .replace(/\s+/g, " ")
        .replace(/ (\??\.)/g, "$1")
        .trim();
      return text.length <= 120 ? text : `${text.slice(0, 117)}...`;
    }

    function requestEnd(text: string, from: number): number {
      const re = new RegExp(requestCall.source, "g");
      re.lastIndex = from;
      const m = re.exec(text);
      if (!m) return from;
      const close = matchForward(text, m.index + m[0].length - 1);
      return close === -1 ? m.index + m[0].length : close + 1;
    }

    return (file, contents) => {
      if (!/\bawait\b/.test(contents)) return [];
      if (!requestCall.test(contents)) return [];
      const text = maskCommentsAndStrings(contents);
      const violations: Violation[] = [];
      const report = (at: number, snippet: string) =>
        violations.push({
          file,
          line: lineOf(contents, at),
          snippet,
          message: discardedQueryMessage
        });

      for (const m of text.matchAll(/\bawait\b/g)) {
        const at = m.index ?? 0;
        if (at > 0 && /[\w$.]/.test(text.charAt(at - 1))) continue;
        const chain = parseChain(text, at + m[0].length);
        if (!chain) continue;
        const { query, write } = classify(chain);
        if (!query) continue;
        const request = requestEnd(text, at);

        const prev = skipSpaceBack(text, at - 1);
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
            const before = skipSpaceBack(text, pattern.open - 1);
            const from =
              text[before] === "(" ? pattern.open : wordStart(text, before);
            report(from, snippetOf(contents, from, request));
          }
          continue;
        }

        if (text[prev] === "(") {
          const close = skipSpace(text, chain.end);
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
            (s) => s.call && writeCalls.has(s.name)
          );
          report(at, `${snippetOf(contents, at, request)}.${verb?.name}(`);
        }
      }
      return violations;
    };
  }
});
