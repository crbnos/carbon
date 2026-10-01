// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

/**
 * A write must not name `createdBy` / `updatedBy` on a table that has no such
 * column. PostgREST rejects the whole statement with
 * `PGRST204 Could not find the 'createdBy' column of '<table>' in the schema
 * cache`, and TypeScript does not catch it — supabase-js widens the
 * insert/upsert argument enough that the excess property survives, which is how
 * `sales-rfq.$rfqId.map-lines.ts` shipped an upsert on `customerPartToItem`
 * (six columns, none of them audit) whose result was never checked, so every
 * RFQ-line → customer-part mapping silently failed.
 *
 * Roughly a third of Carbon's tables have no audit columns — favourites, link
 * tables, the lean material lookups, `companySettings` — while the convention
 * (`conventions-index.md` golden rule 3) says to include them, so this is an
 * easy assumption to carry into the wrong table.
 *
 * Scope is the KEYS of the literal row object(s) in the write's FIRST argument.
 * A payload object spread into the row (`insert([row])`) can carry the same bad
 * key, but only the caller knows what is in it; for the MCP/API layer that
 * decision is derived from this same generated schema by
 * `withoutAbsentAuditColumns` in `scripts/lib/service-metadata.ts`.
 *
 * Both halves of the match are structural rather than textual, because the loose
 * version of each produced false findings and this check gates commits through
 * `collectFindings`:
 *
 *  - The write must sit in the matched target's OWN call chain. A character
 *    window picks up the NEXT statement's write instead, so
 *    `from("link").select("id"); from("item").insert({ createdBy })` reported
 *    `createdBy` against `link`.
 *  - A name must be in key POSITION in a row object. Matching the bare name
 *    anywhere flagged an identifier used as a value
 *    (`update({ name: createdBy })`), flagged the keys of nested value objects,
 *    and missed a quoted key (`{ "createdBy": userId }`) entirely.
 */
const AUDIT_FIELDS = ["createdBy", "updatedBy"] as const;
type AuditField = (typeof AUDIT_FIELDS)[number];

/** `.from("t")`, `insertInto("t")`, `updateTable("t")`. */
const TARGET_RE = /(?:\.from|insertInto|updateTable)\(\s*["'`](\w+)["'`]\s*\)/g;

/** Chain members whose first argument carries the row(s). */
const WRITE_VERBS = new Set(["insert", "upsert", "update", "values", "set"]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

/** Index just past the string literal that opens at `i`. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === quote) return j + 1;
  }
  return text.length;
}

/** Index just past the comment that opens at `i`, or `i` when there is none. */
function skipComment(text: string, i: number): number {
  if (text[i] !== "/") return i;
  if (text[i + 1] === "/") {
    const nl = text.indexOf("\n", i);
    return nl === -1 ? text.length : nl + 1;
  }
  if (text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return i;
}

/** Index of the first character at or after `i` that is neither space nor comment. */
function skipTrivia(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
    const after = skipComment(text, i);
    if (after === i) return i;
    i = after;
  }
}

/** Index of the bracket matching the one at `open`, skipping strings and comments. */
function matchBracket(text: string, open: number): number {
  const close = { "(": ")", "[": "]", "{": "}" }[text[open] as string];
  if (!close) return open;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i) - 1;
      continue;
    }
    if (c === "/") {
      const after = skipComment(text, i);
      if (after !== i) {
        i = after - 1;
        continue;
      }
    }
    if (c === text[open]) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/**
 * The opening paren of the write call belonging to the SAME chain as a target
 * that ends at `from`, else null. Walks `.member(…)` segments and stops at
 * anything that is not one — a `;`, a new statement, the end of an expression.
 */
function writeInChain(contents: string, from: number): number | null {
  let i = from;
  for (;;) {
    i = skipTrivia(contents, i);
    if (contents[i] !== ".") return null;
    i = skipTrivia(contents, i + 1);
    if (!IDENT_START.test(contents[i] ?? "")) return null;
    let end = i;
    while (end < contents.length && IDENT_PART.test(contents[end] as string)) {
      end++;
    }
    const member = contents.slice(i, end);
    const afterMember = skipTrivia(contents, end);
    if (contents[afterMember] !== "(") {
      // A property access rather than a call — keep walking the same chain.
      i = afterMember;
      continue;
    }
    if (WRITE_VERBS.has(member)) return afterMember;
    i = matchBracket(contents, afterMember) + 1;
  }
}

/**
 * Top-level keys of the row object(s) in the call's FIRST argument, each with
 * its absolute index. A ROW object is an object literal with no enclosing object
 * literal, so `insert({…})` and `insert([{…}, {…}])` both yield rows while a
 * nested value object does not. The second argument (`{ onConflict }`) is never
 * reached, and shorthand, `key:` and `"key":` forms all count.
 */
function rowKeys(
  contents: string,
  open: number
): { name: string; index: number }[] {
  const close = matchBracket(contents, open);
  const keys: { name: string; index: number }[] = [];
  // One frame per open object literal: whether it is a row, and whether we are
  // inside a nested bracket/paren of it (where a comma separates values, not
  // keys).
  const frames: { isRow: boolean; nesting: number }[] = [];
  // Brackets/parens seen OUTSIDE every object literal, so an array of rows
  // (`insert([{…}, {…}])`) is not mistaken for a second argument.
  let outerNesting = 0;
  let expectKey = false;

  for (let i = open + 1; i < close; i++) {
    const c = contents[i] as string;
    const frame = frames[frames.length - 1];
    const inKeyPosition =
      expectKey && frame?.isRow === true && frame.nesting === 0;

    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(contents, i);
      if (inKeyPosition) {
        const raw = contents.slice(i + 1, end - 1);
        // Only a quoted KEY counts — it must be followed by a colon.
        if (/^\w+$/.test(raw) && contents[skipTrivia(contents, end)] === ":") {
          keys.push({ name: raw, index: i });
        }
      }
      expectKey = false;
      i = end - 1;
      continue;
    }
    if (c === "/") {
      const after = skipComment(contents, i);
      if (after !== i) {
        i = after - 1;
        continue;
      }
    }
    if (c === "{") {
      frames.push({ isRow: frames.length === 0, nesting: 0 });
      expectKey = true;
      continue;
    }
    if (c === "}") {
      frames.pop();
      expectKey = false;
      continue;
    }
    if (c === "[" || c === "(") {
      if (frame) frame.nesting++;
      else outerNesting++;
      expectKey = false;
      continue;
    }
    if (c === "]" || c === ")") {
      if (frame) frame.nesting--;
      else outerNesting--;
      expectKey = false;
      continue;
    }
    if (c === ",") {
      if (!frame) {
        // A comma outside every object literal AND every bracket separates
        // ARGUMENTS: the row(s) are the first one, so stop before
        // `{ onConflict }` and friends. Inside a bracket it separates rows.
        if (outerNesting === 0) break;
        continue;
      }
      expectKey = frame.nesting === 0;
      continue;
    }
    if (/\s/.test(c)) continue;

    if (inKeyPosition && IDENT_START.test(c)) {
      let end = i;
      while (end < close && IDENT_PART.test(contents[end] as string)) end++;
      const afterKey = contents[skipTrivia(contents, end)];
      // `key:`, or shorthand terminated by a comma or the closing brace.
      if (afterKey === ":" || afterKey === "," || afterKey === "}") {
        keys.push({ name: contents.slice(i, end), index: i });
      }
      expectKey = false;
      i = end - 1;
      continue;
    }
    expectKey = false;
  }
  return keys;
}

export function noMissingAuditColumn(
  columns: Map<string, Set<string>>
): ConformanceCheck {
  return {
    id: "no-missing-audit-column",
    description:
      "A write never names createdBy/updatedBy on a table that has no such column — PostgREST rejects the statement with PGRST204 and TypeScript does not catch it.",
    provenance: {
      deprecates:
        "stamping createdBy/updatedBy on a table without audit columns (the customerPartToItem upsert in sales-rfq.$rfqId.map-lines.ts, which failed every call)",
      replacedBy:
        "writing only the columns the table has; the MCP/API layer derives the same answer from the generated types in scripts/lib/service-metadata.ts",
      since: "PGRST204 on items_upsertItemCustomerPart"
    },
    scan(file, contents) {
      const violations: Violation[] = [];
      TARGET_RE.lastIndex = 0;
      for (const target of contents.matchAll(TARGET_RE)) {
        const table = target[1];
        const present = table ? columns.get(table) : undefined;
        if (!present) continue;
        const missing: AuditField[] = AUDIT_FIELDS.filter(
          (f) => !present.has(f)
        );
        if (missing.length === 0) continue;

        const open = writeInChain(contents, target.index + target[0].length);
        if (open === null) continue;

        for (const key of rowKeys(contents, open)) {
          if (!missing.includes(key.name as AuditField)) continue;
          violations.push({
            file,
            line: contents.slice(0, key.index).split("\n").length,
            snippet: key.name,
            message: `"${table}" has no "${key.name}" column — this write fails with PGRST204 (and TypeScript will not flag it). Remove the field.`
          });
        }
      }
      return violations;
    }
  };
}
