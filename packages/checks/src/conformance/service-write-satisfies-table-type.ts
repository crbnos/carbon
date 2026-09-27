import type { ConformanceCheck, Violation } from "../check";

/**
 * A literal object a `*.service.ts` writes through the Supabase client must be
 * checked against the table's own type:
 *
 *   client.from("payment").insert({ ... } satisfies TablesInsert<"payment">)
 *   client.from("item").update({ ... } satisfies TablesUpdate<"item">)
 *
 * postgrest-js types `.insert()` / `.update()` loosely enough that a key the
 * table does not have compiles, and PostgREST then refuses the whole write
 * with PGRST204 at runtime. That shipped more than once: `closed: true` on
 * salesOrder/purchaseOrder, `parentJobId` on job, `unitCost` on item — each an
 * opaque "database error" for any caller. `satisfies` turns the phantom
 * column into a compile error at the literal.
 *
 * Scope: a literal passed directly (optionally inside `[...]` or
 * `sanitize(...)`). A literal built earlier and passed by name is checked
 * where it is built — give that `const` the same `satisfies`. Spreads of a
 * form payload are not caught by `satisfies` either; the fix there is picking
 * columns explicitly (see `updateItem`).
 *
 * Existing writes are baselined; a new literal write must carry it.
 */
const MESSAGE =
  'A literal service write must be typed against its table: add `satisfies TablesInsert<"t">` (insert/upsert) or `satisfies TablesUpdate<"t">` (update) from @carbon/database, so a column the table does not have fails typecheck instead of PGRST204 at runtime.';

const WRITE =
  /\.from\(\s*"(\w+)"\s*\)\s*\.(insert|update|upsert)\(\s*(?:sanitize\(\s*)?(?:\[\s*)?\{/g;

const FUNCTION =
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g;

/** Index of the `}` closing the `{` at `open`, skipping strings and comments. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") {
        i++;
      } else if (c === quote) {
        quote = null;
      } else if (quote === "`" && c === "$" && text[i + 1] === "{") {
        const end = matchBrace(text, i + 1);
        if (end < 0) return -1;
        i = end;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      if (nl < 0) return -1;
      i = nl;
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return -1;
      i = close + 1;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The name of the function declared closest before `index`. */
function enclosingFunction(text: string, index: number): string {
  let name = "<module>";
  for (const m of text.slice(0, index).matchAll(FUNCTION)) {
    name = m[1] ?? m[2] ?? name;
  }
  return name;
}

export const serviceWriteSatisfiesTableType: ConformanceCheck = {
  id: "service-write-satisfies-table-type",
  description:
    "A literal object a *.service.ts inserts, upserts or updates through the Supabase client is typed `satisfies TablesInsert<T>` / `TablesUpdate<T>`, so a phantom column fails typecheck.",
  provenance: {
    deprecates:
      "untyped literal writes (`.update({ closed: true, … })`) that compile against postgrest-js and fail with PGRST204",
    replacedBy:
      '`{ … } satisfies TablesInsert<"t">` / `TablesUpdate<"t">` from @carbon/database at the literal'
  },
  scan(file, contents) {
    if (!file.endsWith(".service.ts")) return [];
    const violations: Violation[] = [];
    for (const m of contents.matchAll(WRITE)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const close = matchBrace(contents, open);
      if (close < 0) continue;
      const after = contents.slice(close + 1).trimStart();
      if (after.startsWith("satisfies ")) continue;
      const line = contents.slice(0, m.index).split("\n").length;
      const fn = enclosingFunction(contents, m.index ?? 0);
      violations.push({
        file,
        line,
        snippet: `${fn}: .from("${m[1]}").${m[2]}(`,
        message: MESSAGE
      });
    }
    return violations;
  }
};
