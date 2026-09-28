import type { ConformanceCheck, Violation } from "../check";
import { blankComments } from "./no-unscoped-kysely-write";
import {
  enclosingFunction,
  isErpServiceFile,
  lineAt,
  matchingParen
} from "./supabase-chain";

/**
 * A PostgREST `.or(...)` filter string in an ERP service is built from
 * sanitised values and top-level columns only.
 *
 * `.or()` takes one string in PostgREST's logic-tree grammar: `,` separates
 * conditions and `(` `)` group them. Two hand-built shapes break it:
 *
 * - A caller value interpolated into the string. A search for "Bracket, M8"
 *   splits into two conditions, the second without a column, and PostgREST
 *   rejects the request (PGRST100), which the API reports as an unknown
 *   database error. A value can also add conditions of its own. Free-text
 *   search goes through `setSearchFilter` (`~/utils/query`), which strips
 *   `,()\\` and ANDs one `.or()` per token.
 * - A dotted embedded column (`jobOperation.description.ilike.…`) in a
 *   top-level `or`. PostgREST reads `jobOperation` as the column and
 *   `description` as the operator and rejects every such request. Filter an
 *   embed with a `!inner` embed plus `.ilike("embed.col", …)`, or
 *   `setSearchFilter(…, { referencedTable })`; a search across a parent column
 *   and an embed column needs a view column or pre-resolved ids.
 *
 * Allowed interpolations: values inside an `in.(…)` list (id arrays) and
 * identifiers named like ids (`${companyId}`), which come from the auth
 * context or a prior read, not free text. A `.or()` whose argument is not a
 * string literal (a helper's return value) is not inspected.
 */

const MESSAGE_VALUE =
  "A caller value is interpolated into a PostgREST .or() filter: a comma or parenthesis in it breaks the filter (PGRST100) or adds conditions. Use setSearchFilter(query, search, columns) from ~/utils/query.";
const MESSAGE_DOTTED =
  'A dotted embedded column in a top-level .or() is always rejected by PostgREST (PGRST100). Use a !inner embed with .ilike("embed.col", …), setSearchFilter(…, { referencedTable }), or a view column.';

/** PostgREST filter operators: the middle segment of `col.op.value`. */
const OPERATORS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "match",
  "imatch",
  "is",
  "isdistinct",
  "in",
  "cs",
  "cd",
  "ov",
  "sl",
  "sr",
  "nxl",
  "nxr",
  "adj",
  "fts",
  "plfts",
  "phfts",
  "wfts",
  "not",
  "all",
  "any"
]);
const LOGIC = new Set(["and", "or", "not"]);

const OR_CALL = /\.or\s*\(/g;
const ID_LIKE = /^[\w$.?!]*(?:[iI]d|[iI]ds)$/;

/** `${…}` expressions in a template literal body, with their offsets. */
function interpolations(body: string): { expr: string; at: number }[] {
  const out: { expr: string; at: number }[] = [];
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] !== "$" || body[i + 1] !== "{") continue;
    let depth = 0;
    for (let j = i + 1; j < body.length; j++) {
      if (body[j] === "{") depth++;
      else if (body[j] === "}") {
        depth--;
        if (depth === 0) {
          out.push({ expr: body.slice(i + 2, j).trim(), at: i });
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

/** True when the offset sits inside an unclosed `in.(` list. */
function insideInList(body: string, at: number): boolean {
  const open = body.lastIndexOf("in.(", at);
  if (open === -1) return false;
  return !body.slice(open + 4, at).includes(")");
}

function allowedInterpolation(body: string, at: number, expr: string) {
  if (insideInList(body, at)) return true;
  // `${ids.join(",")}`, `${quoted(ids)}` and the like: an id list.
  const bare = expr
    .replace(/\s+/g, "")
    .replace(/\?\?(?:""|''|``)$/, "")
    .replace(/\.join\([^)]*\)$/, "");
  return ID_LIKE.test(bare);
}

/** Dotted `embed.column.operator` tokens at the start of a condition. */
function dottedEmbeddedColumns(body: string): string[] {
  const flat = body.replace(/\$\{[^}]*\}/g, "X");
  const out: string[] = [];
  for (const m of flat.matchAll(
    /(?:^|[,(])\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g
  )) {
    const [, first, second] = m;
    if (LOGIC.has(first!)) continue;
    if (OPERATORS.has(second!)) continue;
    out.push(`${first}.${second}`);
  }
  return out;
}

export const noRawOrFilter: ConformanceCheck = {
  id: "no-raw-or-filter",
  description:
    "A PostgREST .or() filter in an ERP service interpolates no caller value (use setSearchFilter) and names no dotted embedded column at top level.",
  provenance: {
    deprecates:
      "a search value interpolated into a query.or() template, and a dotted embed.col.ilike token in a top-level query.or() (PGRST100 on a comma, always PGRST100 on a dotted column)",
    replacedBy:
      "setSearchFilter(query, search, columns[, { referencedTable }]) from ~/utils/query; !inner embed + .ilike for embed-only search; a view column or pre-resolved ids for mixed search"
  },
  scan(file, contents) {
    if (!isErpServiceFile(file) || !contents.includes(".or(")) return [];
    const text = blankComments(contents);
    const violations: Violation[] = [];
    for (const m of text.matchAll(OR_CALL)) {
      const start = m.index ?? 0;
      const open = start + m[0].length - 1;
      const args = text.slice(open + 1, matchingParen(text, open));
      const literal = /^\s*(["'`])/.exec(args);
      if (!literal) continue;
      const quote = literal[1]!;
      const bodyStart = args.indexOf(quote) + 1;
      const bodyEnd = args.indexOf(quote, bodyStart);
      const body = args.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd);
      const rest = bodyEnd === -1 ? "" : args.slice(bodyEnd + 1);
      const fn = enclosingFunction(text, start);
      const shown = body.length <= 60 ? body : `${body.slice(0, 57)}...`;
      const snippet = `${fn}: .or(${quote}${shown}${quote})`;

      const raw =
        quote === "`" &&
        interpolations(body).some(
          ({ expr, at }) => !allowedInterpolation(body, at, expr)
        );
      if (raw) {
        violations.push({
          file,
          line: lineAt(text, start),
          snippet,
          message: MESSAGE_VALUE
        });
        continue;
      }

      const scoped = /referencedTable|foreignTable/.test(rest);
      if (!scoped && dottedEmbeddedColumns(body).length > 0) {
        violations.push({
          file,
          line: lineAt(text, start),
          snippet,
          message: MESSAGE_DOTTED
        });
      }
    }
    return violations;
  }
};
