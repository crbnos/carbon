import type { ConformanceCheck, Violation } from "../check";
import { blankComments } from "./no-unscoped-kysely-write";
import { isErpServiceFile, lineAt, matchingParen } from "./supabase-chain";

/**
 * Every key a READ service declares in its inline `args` type is read by the
 * function body.
 *
 * The API and MCP server publish each service's parameter types as the tool's
 * input schema (`scripts/lib/service-metadata.ts`), so a declared
 * `status?: string` becomes an advertised filter. When the body never applies
 * it, the call succeeds and returns every row, unfiltered, with no warning:
 * `getSalesOrders` declared `status` and ignored it while the UI route passed
 * `?status=`. Apply the key or remove it (the generic `filters` array already
 * covers ad-hoc column filters).
 *
 * Scope: exported READ functions (the generator's `get|list|fetch|search|find|
 * count|check|is|has|compute` prefixes) in ERP service files, and only keys of
 * an inline object type on a parameter named `args`/`filters`/`params`. The
 * `GenericQueryFilters` keys (`limit`, `offset`, `sorts`, `filters`) are read by
 * `setGenericQueryFilters`. A body that passes `args` whole to another call, or
 * spreads it, is assumed to read every key.
 */

const MESSAGE =
  "This READ service declares an args key its body never reads, so the published API/MCP schema advertises a filter that is silently ignored. Apply it or remove it from the type.";

const READ_NAME =
  /^(get|list|fetch|search|find|count|check|is|has|compute)(?![a-z])/;
const EXPORTED_FUNCTION =
  /(?:^|\n)export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/g;
const ARG_NAMES = ["args", "filters", "params"];
const GENERIC_KEYS = new Set(["limit", "offset", "sorts", "filters"]);

/** Index of the `}` closing the `{` at `open`. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** The parameter list split at depth-0 commas. */
function splitParams(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < params.length; i++) {
    const ch = params[i];
    if (ch === "(" || ch === "{" || ch === "[" || ch === "<") depth++;
    else if (ch === ")" || ch === "}" || ch === "]" || ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      out.push(params.slice(last, i));
      last = i + 1;
    }
  }
  out.push(params.slice(last));
  return out.map((p) => p.trim()).filter(Boolean);
}

/** Keys of every top-level inline `{ … }` object type in a type expression. */
function inlineKeys(type: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < type.length; i++) {
    if (type[i] !== "{") continue;
    const close = matchingBrace(type, i);
    const body = type.slice(i + 1, close);
    let depth = 0;
    let member = "";
    for (const ch of `${body};`) {
      if (ch === "{" || ch === "(" || ch === "[" || ch === "<") depth++;
      else if (ch === "}" || ch === ")" || ch === "]" || ch === ">") depth--;
      if ((ch === ";" || ch === ",") && depth === 0) {
        const m = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(
          member
        );
        if (m) keys.push(m[1]!);
        member = "";
      } else {
        member += ch;
      }
    }
    i = close;
  }
  return keys;
}

function readsKey(body: string, arg: string, key: string): boolean {
  const access = new RegExp(
    `\\b${arg}\\s*(?:\\?\\.|!\\.|\\.)\\s*${key}\\b|\\b${arg}\\s*(?:\\?\\.)?\\[\\s*["'\`]${key}["'\`]\\s*\\]`
  );
  if (access.test(body)) return true;
  // const { key, … } = args
  const destructure = new RegExp(
    `\\{[^{}]*\\b${key}\\b[^{}]*\\}\\s*=\\s*${arg}\\b`
  );
  return destructure.test(body);
}

/**
 * `args` handed on whole (`helper(client, args)`, `{ ...args }`,
 * `const x = args`), so this file cannot tell which keys are read. A truthiness
 * test (`if (args)`, `args && …`) and `setGenericQueryFilters(query, args)`,
 * which reads only the generic keys, do not count.
 */
function passesWhole(body: string, arg: string): boolean {
  const bare = new RegExp(
    `\\b${arg}\\b(?!\\s*(?:\\?\\.|!\\.|\\.|\\[|\\?\\[))`,
    "g"
  );
  for (const m of body.matchAll(bare)) {
    const at = m.index ?? 0;
    const before = body.slice(Math.max(0, at - 60), at);
    const after = body.slice(at + arg.length, at + arg.length + 3);
    if (/\.\.\.\s*$/.test(before)) return true;
    if (/setGenericQueryFilters\s*\(\s*\w+\s*,\s*$/.test(before)) continue;
    if (/\b(?:if|while)\s*\(\s*!?\s*$/.test(before)) continue;
    if (
      /(?:&&|\|\||!|\?\?)\s*$/.test(before) ||
      /^\s*(?:&&|\|\||\?)/.test(after)
    ) {
      continue;
    }
    if (/[(,]\s*$/.test(before) || /[=:]\s*$/.test(before)) return true;
  }
  return false;
}

export const declaredArgUnused: ConformanceCheck = {
  id: "declared-arg-unused",
  description:
    "A READ service in an ERP module reads every key of its inline args type — the key is published as an API/MCP filter, and an unread key is a filter that is silently ignored.",
  provenance: {
    deprecates:
      "getSalesOrders(args: { status: string | null; … }) with no args.status in the body: a published filter that returns every row",
    replacedBy:
      "apply the key (.eq(column, args.key)) or remove it from the args type"
  },
  scan(file, contents) {
    if (!isErpServiceFile(file)) return [];
    const text = blankComments(contents);
    const violations: Violation[] = [];
    for (const m of text.matchAll(EXPORTED_FUNCTION)) {
      const name = m[1]!;
      if (!READ_NAME.test(name)) continue;
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = matchingParen(text, open);
      // The body runs to the top-level function's closing `}` at column 0;
      // a return type annotation in between (whose own `}` is followed by `>`)
      // names no `args.key`.
      const end = text.slice(close).search(/\n}[ \t]*(?:\n|$)/);
      const body = text.slice(close, end === -1 ? undefined : close + end);

      for (const param of splitParams(text.slice(open + 1, close))) {
        const pm = /^([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]*)$/.exec(param);
        if (!pm) continue;
        const [, arg, type] = pm;
        if (!ARG_NAMES.includes(arg!)) continue;
        if (passesWhole(body, arg!)) continue;
        for (const key of inlineKeys(type!)) {
          if (GENERIC_KEYS.has(key)) continue;
          if (readsKey(body, arg!, key)) continue;
          violations.push({
            file,
            line: lineAt(text, m.index ?? 0) + (m[0].startsWith("\n") ? 1 : 0),
            snippet: `${name}: ${arg}.${key}`,
            message: MESSAGE
          });
        }
      }
    }
    return violations;
  }
};
