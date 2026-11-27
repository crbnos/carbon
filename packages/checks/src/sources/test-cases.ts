// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CallExpression, Program } from "oxc-parser";
import type { SourceFile } from "../check";
import { isNamedMember, type Node, parseTypescript, walk } from "./syntax";

// What declares a vitest case in a parsed file: `it`/`test` with any modifier
// chain, and the `(name, fn)` wrappers around them, in the file or exported by
// the shared database-test fixtures.

const SHARED_TEST_FIXTURES_DIR = "apps/erp/test/database/fixtures";

/** The shared database-test fixtures, which export `databaseTest` and its kin. */
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
// ARG_MODIFIERS take their own arguments before the case's
// (`it.each(rows)(…)`, `it.each\`table\`(…)`, `it.skipIf(c)(…)`).
const MODIFIERS = new Set([
  "only",
  "skip",
  "todo",
  "fails",
  "concurrent",
  "sequential"
]);
const ARG_MODIFIERS = new Set(["each", "for", "skipIf", "runIf"]);

/**
 * Whether calling `callee` declares a test case: one of `names` with any
 * modifier chain (`it.only`, `it.skipIf(c)`, `it.each\`…\``). `it.extend(…)`,
 * `test.describe` and `regex.test` do not.
 */
function declaresCase(callee: Node, names: ReadonlySet<string>): boolean {
  if (callee.type === "Identifier") return names.has(callee.name);
  if (isNamedMember(callee)) {
    return (
      MODIFIERS.has(callee.property.name) && declaresCase(callee.object, names)
    );
  }
  let configured: Node | undefined;
  if (callee.type === "CallExpression") configured = callee.callee;
  if (callee.type === "TaggedTemplateExpression") configured = callee.tag;
  return (
    configured !== undefined &&
    isNamedMember(configured) &&
    ARG_MODIFIERS.has(configured.property.name) &&
    declaresCase(configured.object, names)
  );
}

/** Every call under `node` that declares a test case. */
export function caseCalls(
  node: Node,
  names: ReadonlySet<string>
): CallExpression[] {
  const out: CallExpression[] = [];
  walk(node, (child) => {
    if (child.type === "CallExpression" && declaresCase(child.callee, names)) {
      out.push(child);
    }
  });
  return out;
}

export type NamedFunction = { name: string; node: Node; exported: boolean };

const isExport = (node: Node | undefined) =>
  node?.type === "ExportNamedDeclaration" ||
  node?.type === "ExportDefaultDeclaration";

/** Every function the file names, at any depth: `function f`, `const f = () =>`. */
export function namedFunctions(program: Program): NamedFunction[] {
  const out: NamedFunction[] = [];
  walk(program, (node, ancestors) => {
    const exported = isExport(ancestors.at(-1));
    if (node.type === "FunctionDeclaration" && node.id) {
      out.push({ name: node.id.name, node, exported });
    }
    if (node.type !== "VariableDeclaration") return;
    for (const { id, init } of node.declarations) {
      if (
        id.type === "Identifier" &&
        (init?.type === "ArrowFunctionExpression" ||
          init?.type === "FunctionExpression")
      ) {
        out.push({ name: id.name, node: init, exported });
      }
    }
  });
  return out;
}

/**
 * `names` plus each function whose body declares a case of one of them. It
 * repeats until nothing new is found, so a wrapper of a wrapper counts.
 */
export function withWrappers(
  names: Iterable<string>,
  functions: NamedFunction[]
): Set<string> {
  const out = new Set(names);
  for (let grew = true; grew;) {
    grew = false;
    for (const { name, node } of functions) {
      if (!out.has(name) && caseCalls(node, out).length > 0) {
        out.add(name);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * The `(name, fn)` wrappers the shared fixtures export, found to a fixpoint
 * across files so a wrapper of another file's wrapper counts.
 */
export function sharedTestWrappers(fixtures: SourceFile[]): string[] {
  const files = fixtures.map(({ file, contents }) =>
    namedFunctions(parseTypescript(file, contents).program)
  );
  const found = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const functions of files) {
      const wrappers = withWrappers(["it", "test", ...found], functions);
      for (const { name, exported } of functions) {
        if (exported && wrappers.has(name) && !found.has(name)) {
          found.add(name);
          grew = true;
        }
      }
    }
  }
  return [...found];
}
