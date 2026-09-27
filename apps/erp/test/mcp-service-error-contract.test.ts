import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AwaitExpression,
  type FunctionDeclaration,
  type Node,
  Project,
  SyntaxKind
} from "ts-morph";
import { describe, expect, it } from "vitest";
import { MODULE_LIST } from "../../../scripts/lib/service-metadata";

// Every exported service is an API/MCP operation. A Supabase response whose
// `error` is never read turns a failed query into an empty success — the
// tool answers "no rows" when the query failed. This scan fails on any awaited
// Supabase/storage/functions response in an exported service whose error is
// neither read nor forwarded, against a committed baseline that may only
// shrink (.claude/rules/conventions-services.md → The result contract).
//
// Accepted as handled:
// - a builder returned or passed on without `await` (never inspected here);
// - `return await q`, `foo(await q)`, `[await q]` — forwarded whole;
// - `const r = await q` where `r` is used other than as `r.data` / `r.count`
//   (`r.error`, `return r`, `{ ...r }`, `const { error } = r`);
// - `const { data, error: e } = await q` where the binding is referenced;
// - `const rs = await Promise.all([...])` where `rs` is checked through
//   an expression mentioning `error` (`rs.some((r) => r.error)`) or forwarded;
// - tuple destructuring of `Promise.all`, each element judged as above.
//
// Regenerate the baseline after fixing sites:
//   UPDATE_ERROR_BASELINE=1 pnpm vitest run test/mcp-service-error-contract.test.ts

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = join(HERE, "../app/modules");
const BASELINE_FILE = join(HERE, "mcp-service-error-contract.baseline.json");

/** A Supabase client call chain: `.from(`, `.rpc(`, storage, functions. */
const SUPABASE_CALL =
  /(?<!\bArray)\.(from|rpc)\(|\bstorage\(|\.storage\b|\.functions\.invoke\(/;

function isSupabaseExpression(node: Node, fn: FunctionDeclaration): boolean {
  if (node.isKind(SyntaxKind.Identifier)) {
    // `let query = client.from(...); … await query`
    const name = node.getText();
    return fn
      .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
      .some((decl) => {
        if (decl.getName() !== name) return false;
        const init = decl.getInitializer();
        return !!init && SUPABASE_CALL.test(init.getText());
      });
  }
  if (!node.isKind(SyntaxKind.CallExpression)) return false;
  const text = node.getText();
  if (/^Promise\.(all|allSettled|race)\(/.test(text)) return false;
  return SUPABASE_CALL.test(text);
}

function referencesOf(fn: FunctionDeclaration, name: string, except: Node) {
  return fn
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter(
      (id) =>
        id.getText() === name &&
        id !== except &&
        // `{ error: e }` — the property name is not a reference.
        !(
          id.getParent()?.isKind(SyntaxKind.PropertyAssignment) &&
          id.getParentOrThrow().getChildAtIndex(0) === id
        ) &&
        !(
          id.getParent()?.isKind(SyntaxKind.PropertyAccessExpression) &&
          id.getParentOrThrow().getChildAtIndex(2) === id
        )
    );
}

/** `r` from `const r = await q`: is its error read or the whole value used? */
function singleHandled(fn: FunctionDeclaration, name: Node): boolean {
  const refs = referencesOf(fn, name.getText(), name);
  return refs.some((ref) => {
    const parent = ref.getParent();
    if (parent?.isKind(SyntaxKind.PropertyAccessExpression)) {
      const member = parent.getName();
      return member !== "data" && member !== "count";
    }
    return true;
  });
}

/** `rs` from `const rs = await Promise.all(...)`. */
function arrayHandled(fn: FunctionDeclaration, name: Node): boolean {
  const refs = referencesOf(fn, name.getText(), name);
  return refs.some((ref) => {
    let node: Node | undefined = ref;
    // Climb to the statement and look for an `error` check in it.
    while (node && !node.getParent()?.isKind(SyntaxKind.Block)) {
      node = node.getParent();
    }
    const statement = node?.getText() ?? "";
    if (/\berror\b/.test(statement)) return true;
    const parent = ref.getParent();
    // Forwarded whole.
    return (
      !parent?.isKind(SyntaxKind.PropertyAccessExpression) &&
      !parent?.isKind(SyntaxKind.ElementAccessExpression) &&
      !parent?.isKind(SyntaxKind.ForOfStatement)
    );
  });
}

function bindingHandled(fn: FunctionDeclaration, binding: Node): boolean {
  if (binding.isKind(SyntaxKind.Identifier)) return singleHandled(fn, binding);
  if (binding.isKind(SyntaxKind.ObjectBindingPattern)) {
    for (const element of binding.getElements()) {
      if (element.getDotDotDotToken()) return true;
      const property = element.getPropertyNameNode()?.getText();
      const local = element.getNameNode();
      if ((property ?? local.getText()) !== "error") continue;
      return referencesOf(fn, local.getText(), local).length > 0;
    }
    return false;
  }
  return true;
}

function awaitedCount(expr: Node, fn: FunctionDeclaration) {
  // `await Promise.all([q1, q2])` → per-element; `Promise.all(xs.map(...))` → array.
  if (expr.isKind(SyntaxKind.CallExpression)) {
    const callee = expr.getExpression().getText();
    if (callee === "Promise.all") {
      const [arg] = expr.getArguments();
      if (arg?.isKind(SyntaxKind.ArrayLiteralExpression)) {
        return {
          kind: "tuple" as const,
          elements: arg
            .getElements()
            .map((el) => isSupabaseExpression(el, fn))
        };
      }
      if (arg && SUPABASE_CALL.test(arg.getText())) {
        return { kind: "array" as const };
      }
      return null;
    }
  }
  return isSupabaseExpression(expr, fn) ? { kind: "single" as const } : null;
}

function unhandledAwaits(fn: FunctionDeclaration): number {
  let unhandled = 0;
  for (const awaitExpr of fn.getDescendantsOfKind(
    SyntaxKind.AwaitExpression
  ) as AwaitExpression[]) {
    const shape = awaitedCount(awaitExpr.getExpression(), fn);
    if (!shape) continue;

    let parent = awaitExpr.getParentOrThrow();
    while (
      parent.isKind(SyntaxKind.ParenthesizedExpression) ||
      parent.isKind(SyntaxKind.AsExpression)
    ) {
      parent = parent.getParentOrThrow();
    }

    if (parent.isKind(SyntaxKind.VariableDeclaration)) {
      const binding = parent.getNameNode();
      if (shape.kind === "single") {
        if (!bindingHandled(fn, binding)) unhandled++;
      } else if (shape.kind === "array") {
        if (binding.isKind(SyntaxKind.Identifier)) {
          if (!arrayHandled(fn, binding)) unhandled++;
        } else unhandled++;
      } else if (binding.isKind(SyntaxKind.ArrayBindingPattern)) {
        binding.getElements().forEach((element, i) => {
          if (!shape.elements[i]) return;
          if (element.isKind(SyntaxKind.OmittedExpression)) {
            unhandled++;
          } else if (!bindingHandled(fn, element.getNameNode())) {
            unhandled++;
          }
        });
      } else if (binding.isKind(SyntaxKind.Identifier)) {
        if (!arrayHandled(fn, binding)) {
          unhandled += shape.elements.filter(Boolean).length;
        }
      }
      continue;
    }

    if (parent.isKind(SyntaxKind.BinaryExpression)) {
      // `x = await q` — judge the assigned variable like a declaration.
      const left = parent.getLeft();
      if (left.isKind(SyntaxKind.Identifier) && shape.kind === "single") {
        if (!singleHandled(fn, left)) unhandled++;
      }
      continue;
    }

    if (parent.isKind(SyntaxKind.PropertyAccessExpression)) {
      // `(await q).data` — only `.error` counts as reading it.
      if (parent.getName() !== "error") unhandled++;
      continue;
    }

    if (parent.isKind(SyntaxKind.ExpressionStatement)) {
      // `await q;` — the response, error included, is discarded.
      unhandled += shape.kind === "tuple" ? shape.elements.filter(Boolean).length : 1;
    }
    // Returned, passed as an argument, placed in a literal: forwarded.
  }
  return unhandled;
}

function serviceFiles(): string[] {
  // The modules the MCP/API generator publishes.
  return MODULE_LIST.flatMap((mod) =>
    [`${mod}.service.ts`, `${mod}.ee.service.ts`, `${mod}.mcp.server.ts`].map(
      (name) => join(MODULES_DIR, mod, name)
    )
  ).filter((path) => existsSync(path));
}

function scan(): Record<string, number> {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true
  });
  const counts: Record<string, number> = {};
  for (const path of serviceFiles()) {
    const file = project.createSourceFile(
      path.slice(MODULES_DIR.length + 1),
      readFileSync(path, "utf8")
    );
    for (const fn of file.getFunctions()) {
      if (!fn.isExported()) continue;
      const count = unhandledAwaits(fn);
      if (count > 0) {
        counts[`${file.getFilePath().replace(/^\//, "")}:${fn.getName()}`] =
          count;
      }
    }
  }
  return counts;
}

/** Pins the scanner on the shapes it must accept and the ones it must flag. */
function scanSource(source: string): number {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile("fixture.ts", source);
  const fn = file.getFunctions()[0];
  if (!fn) throw new Error("no function");
  return unhandledAwaits(fn);
}

describe("unread-error scanner", () => {
  it.each([
    [
      "an un-awaited returned builder",
      `export function f(c) { return c.from("t").select("*"); }`
    ],
    [
      "a destructured error that is checked",
      `export async function f(c) {
        const { data, error: readError } = await c.from("t").select("*");
        if (readError) return { data: null, error: readError };
        return { data, error: null };
      }`
    ],
    [
      "a tuple checked with some()",
      `export async function f(c, ids) {
        const updates = await Promise.all(ids.map((id) => c.from("t").update({}).eq("id", id)));
        if (updates.some((u) => u.error)) return updates.find((u) => u.error);
        return { data: null, error: null };
      }`
    ],
    [
      "a response forwarded whole",
      `export async function f(c) {
        const result = await c.rpc("fn");
        return result;
      }`
    ],
    [
      "a builder assigned then awaited with its error read",
      `export async function f(c) {
        let query = c.from("t").select("*");
        query = query.eq("a", 1);
        const { data, error } = await query;
        return { data, error };
      }`
    ],
    [
      "Array.from, which is not a query",
      `export async function f(xs) { const a = await Array.from(xs); return a.length; }`
    ]
  ])("accepts %s", (_, source) => {
    expect(scanSource(source)).toBe(0);
  });

  it.each([
    [
      "a destructure without error",
      `export async function f(c) {
        const { data } = await c.from("t").select("*");
        return data ?? [];
      }`,
      1
    ],
    [
      "a response read only through .data",
      `export async function f(c) {
        const rows = await c.from("t").select("*");
        return rows.data ?? [];
      }`,
      1
    ],
    [
      "a discarded write",
      `export async function f(c) {
        await c.from("t").update({ a: 1 }).eq("id", "x");
        return { data: null, error: null };
      }`,
      1
    ],
    [
      "tuple members whose error is never read",
      `export async function f(c) {
        const [a, b] = await Promise.all([c.from("a").select(), c.from("b").select()]);
        return { a: a.data, b: b.data };
      }`,
      2
    ],
    [
      "an inline (await q).data",
      `export async function f(c) {
        return (await c.from("t").select("*")).data ?? [];
      }`,
      1
    ]
  ])("flags %s", (_, source, expected) => {
    expect(scanSource(source)).toBe(expected);
  });
});

describe("exported services read or forward every Supabase error", () => {
  it(
    "has no unread errors beyond the committed baseline",
    () => {
      const actual = scan();
      if (process.env.UPDATE_ERROR_BASELINE) {
        const sorted = Object.fromEntries(
          Object.entries(actual).sort(([a], [b]) => a.localeCompare(b))
        );
        writeFileSync(BASELINE_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
      }
      const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Record<
        string,
        number
      >;

      const grown = Object.entries(actual)
        .filter(([key, count]) => count > (baseline[key] ?? 0))
        .map(
          ([key, count]) =>
            `${key}: ${count} unread (baseline ${baseline[key] ?? 0})`
        );
      expect(
        grown,
        "Read the `error` of every awaited Supabase response, or return the response whole"
      ).toEqual([]);

      // The baseline only shrinks: a fixed site must be removed from it, so it
      // cannot silently regress back up to the old count.
      const stale = Object.entries(baseline)
        .filter(([key, count]) => (actual[key] ?? 0) < count)
        .map(
          ([key, count]) =>
            `${key}: baseline ${count}, now ${actual[key] ?? 0} — lower the baseline`
        );
      expect(stale).toEqual([]);
    },
    120_000
  );
});
