/**
 * Shared text helpers for the conformance rules that read supabase-js query
 * chains in ERP service files (`no-unconfirmed-write`, `no-raw-or-filter`,
 * `declared-arg-unused`). Like every conformance check they work on one
 * file's text: no type information, no cross-file resolution.
 */

/** ERP service files: the functions the public API and MCP server publish. */
export function isErpServiceFile(file: string): boolean {
  return (
    file.startsWith("apps/erp/app/modules/") && file.endsWith(".service.ts")
  );
}

/**
 * The text of the statement that starts at `from`: up to the first `;`, `,`,
 * `:` or ternary/nullish `?` at bracket depth 0, or the bracket that closes
 * around it. A chain split across variables (`let q = …; q = q.eq(…)`) ends at
 * the first `;`.
 */
export function statementFrom(text: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
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
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return text.slice(from, i);
      depth--;
    } else if (depth === 0) {
      // `;` `,` end a statement; `:` and a ternary/nullish `?` (not `?.`)
      // end one branch of `cond ? a : b` / `a ?? b`.
      if (ch === ";" || ch === "," || ch === ":") return text.slice(from, i);
      if (ch === "?" && text[i + 1] !== ".") return text.slice(from, i);
    }
  }
  return text.slice(from);
}

export type ChainCall = { name: string; args: string };

/**
 * The `.name(args)` calls chained at depth 0 of a statement, in order. Text
 * inside a call's parentheses belongs to that call's `args`.
 */
export function chainCalls(statement: string): ChainCall[] {
  const calls: ChainCall[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < statement.length; i++) {
    const ch = statement[i];
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
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      continue;
    }
    if (depth !== 0 || ch !== ".") continue;
    const m = /^\.\s*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/.exec(
      statement.slice(i, i + 200)
    );
    if (!m) continue;
    const open = i + m[0].length - 1;
    const close = matchingParen(statement, open);
    calls.push({ name: m[1]!, args: statement.slice(open + 1, close) });
    i = close;
  }
  return calls;
}

/** Index of the `)` closing the `(` at `open`, string-aware. */
export function matchingParen(text: string, open: number): number {
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
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** The first argument when it is a plain string literal, else null. */
export function literalFirstArg(args: string): string | null {
  const m = /^\s*(["'`])([^"'`$]*)\1/.exec(args);
  return m ? m[2]! : null;
}

const FUNCTION_DECL =
  /(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:^|\n)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*\(/g;

/** The name of the nearest function declared before `offset`, or "<module>". */
export function enclosingFunction(text: string, offset: number): string {
  let name = "<module>";
  for (const m of text.slice(0, offset).matchAll(FUNCTION_DECL)) {
    name = m[1] ?? m[2] ?? name;
  }
  return name;
}

export function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}
