// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript5";
import {
  type Check,
  type ConformanceCheck,
  eachFile,
  fileCheck,
  type SourceFile,
  type Violation
} from "../check";
import { loadTestFiles } from "../sources/test-files";
import { lineOf } from "../sources/text";

// Tests: rules for how a test file is written (.claude/rules/testing.md). A
// test does not mock its own module's neighbours, does not read source or
// migration text, and does not return early and report a pass for a case it
// never ran.

// A test that mocks its own module's neighbours pins the wiring between them:
// it passes while the rule is wrong and fails when the code is reorganised.
// Package specifiers (`@carbon/...`, `node:...`) are not matched here.
const OWN_MODULE_MOCK =
  /\bvi\.(mock|doMock)\(\s*(?:import\(\s*)?(["'`])((?:\.{1,2}|~)\/[^"'`]*)\2/g;

export const testMocksOwnModule = fileCheck(loadTestFiles, {
  id: "test-mocks-own-module",
  description: "Tests do not vi.mock a first-party module by relative path",
  provenance: {
    deprecates:
      "vi.mock of ./, ../ or ~/ modules to reach the logic under test",
    replacedBy:
      "a pure function tested by value, or a database test (.claude/rules/testing.md)",
    since: "2026-10-25"
  },
  scan(file: string, contents: string): Violation[] {
    return [...contents.matchAll(OWN_MODULE_MOCK)].map((match) => ({
      file,
      line: lineOf(contents, match.index),
      snippet: `vi.${match[1]}("${match[3]}")`,
      message:
        "Do not mock our own modules; extract the decision into a pure function and test it by value (.claude/rules/testing.md → Mocks)"
    }));
  }
});

// A test that regexes source or migration text is a change detector: an
// applied migration never changes, a later one can redefine the object, and a
// reformat breaks it. packages/checks is the one place such a rule belongs,
// where it has a baseline and runs over every file.
const READS_SOURCE_MESSAGE =
  "Tests do not read .sql/.ts/.tsx text; test the behaviour, or make the rule a conformance check in packages/checks (.claude/rules/testing.md)";

// A string literal naming source: `.sql`/`.ts`/`.tsx` at its end (a path or an
// extension filter), or the migrations directory.
const SOURCE_LITERAL =
  /["'`][^"'`\n]*\.(?:sql|tsx?)["'`]|["'`][^"'`\n]*\bmigrations\b[^"'`\n]*["'`]/;
// Directory walks filtered by a source extension: `endsWith(".ts")`,
// `/\.tsx?$/`, `new Set([".ts", ".tsx"])`.
const SOURCE_FILTER =
  /["'`]\.(?:sql|tsx?)["'`]|\/[^/\n]*\\\.(?:sql|tsx?)\??\$\//;
const TEMP_DIR = /\b(?:mkdtemp|mkdtempSync|tmpdir)\b/;
const RAW_IMPORT =
  /\bimport\b[^;]*?["'`][^"'`\n]*\.(?:sql|tsx?)\?raw["'`]|import\.meta\.glob\([^)]*\.(?:sql|tsx?)["'`][^)]*(?:\?raw|["']raw["'])/g;
const READ_CALL = /\b(readFileSync|readFile|readdirSync|readdir)\s*\(/g;
const DECLARATION =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:(?::[^=;]+)?=|\s+of\b)|\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;

/**
 * Where the code from `start` ends: at the bracket that closes one opened
 * before `start`, or with `atSemicolon` at a `;` outside brackets; `limit` if
 * neither comes first. Skips strings.
 */
function codeEnd(
  text: string,
  start: number,
  limit: number,
  atSemicolon: boolean
): number {
  let depth = 0;
  for (let i = start; i < limit; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = text.indexOf(c, i + 1);
      i = end === -1 ? limit : end;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth < 0) return i;
    } else if (atSemicolon && c === ";" && depth === 0) return i;
  }
  return limit;
}

/** Index just past the bracket that closes the one at `open`. */
function closeOf(text: string, open: number): number {
  return codeEnd(text, open + 1, text.length, false) + 1;
}

/** Text of a declaration's initializer: up to `;` at depth 0. */
function initializerAt(text: string, start: number): string {
  const limit = Math.min(text.length, start + 4000);
  return text.slice(start, codeEnd(text, start, limit, true));
}

/** What each declared name holds, for following a path through variables. */
function declarations(contents: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of contents.matchAll(DECLARATION)) {
    const name = match[1] ?? match[2];
    if (!name || out.has(name)) continue;
    const start = (match.index ?? 0) + match[0].length;
    out.set(
      name,
      match[2]
        ? contents.slice(start, closeOf(contents, contents.indexOf("{", start)))
        : initializerAt(contents, start)
    );
  }
  return out;
}

/** The text plus everything the names in it hold, a few levels deep. */
function context(text: string, decls: Map<string, string>): string {
  const seen = new Set<string>();
  let out = text;
  let frontier = text;
  for (let depth = 0; depth < 4 && frontier; depth++) {
    let next = "";
    for (const [name] of frontier.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const held = decls.get(name);
      if (held === undefined || seen.has(name)) continue;
      seen.add(name);
      next += `\n${held}`;
    }
    out += next;
    frontier = next;
  }
  return out;
}

export const testReadsSource = fileCheck(loadTestFiles, {
  id: "test-reads-source",
  description: "Tests do not read source or migration text",
  provenance: {
    deprecates:
      "vitest files that readFileSync / ?raw-import .sql, .ts or .tsx and regex them",
    replacedBy:
      "behaviour tests, database tests, or a packages/checks conformance check (.claude/rules/testing.md)",
    since: "2026-10-25"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    const report = (index: number, snippet: string) =>
      violations.push({
        file,
        line: lineOf(contents, index),
        snippet: snippet.replace(/\s+/g, " ").slice(0, 120),
        message: READS_SOURCE_MESSAGE
      });

    for (const match of contents.matchAll(RAW_IMPORT)) {
      report(match.index ?? 0, match[0]);
    }

    const decls = declarations(contents);
    // A local helper that reads (`const read = (p) => readFileSync(...)`) is
    // a read call too, so its call sites are judged by their arguments.
    const readers = [...decls]
      .filter(([, held]) => /\b(?:readFileSync|readFile)\s*\(/.test(held))
      .map(([name]) => name);
    const calls = [...contents.matchAll(READ_CALL)].map((m) => ({
      fn: m[1] as string,
      index: m.index ?? 0,
      open: (m.index ?? 0) + m[0].length - 1,
      helper: false
    }));
    for (const name of readers) {
      for (const m of contents.matchAll(
        new RegExp(`(?<![\\w$.])${name.replace("$", "\\$")}\\s*\\(`, "g")
      )) {
        const index = m.index ?? 0;
        // Skip the declaration itself (`function read(` / `const read = (`).
        if (
          /\bfunction\s+$/.test(contents.slice(Math.max(0, index - 10), index))
        )
          continue;
        calls.push({
          fn: name,
          index,
          open: index + m[0].length - 1,
          helper: true
        });
      }
    }

    const namesSourceAnywhere =
      (SOURCE_LITERAL.test(contents) || SOURCE_FILTER.test(contents)) &&
      !TEMP_DIR.test(contents);

    for (const { fn, index, open, helper } of calls.sort(
      (a, b) => a.index - b.index
    )) {
      const args = contents.slice(open, closeOf(contents, open));
      const held = context(args, decls);
      if (TEMP_DIR.test(held)) continue;
      const isListing = fn === "readdirSync" || fn === "readdir";
      const namesSource = isListing
        ? /["'`][^"'`\n]*\bmigrations\b/.test(held)
        : SOURCE_LITERAL.test(held);
      // The path is a callback or loop parameter, so the variables cannot say
      // what it reads; a file that names source paths and reads one it does
      // not name is reading those.
      // A helper's own read is judged inside it; its call sites only by
      // the path they pass.
      const unnamedRead =
        !isListing &&
        !helper &&
        namesSourceAnywhere &&
        !/["'`][^"'`\n]*\.\w+["'`]/.test(held);
      if (namesSource || unnamedRead) report(index, `${fn}${args}`);
    }
    return violations;
  }
});

// vitest reports a case whose callback returns before asserting as PASSED:
// without a local stack the five cancel-job regressions went green unrun.
const SILENT_PASS_MESSAGE =
  "A test that returns early passes without running: use `it.skipIf(!x)(…)` / `databaseTest` so it reports skipped, or assert the value exists (.claude/rules/testing.md → Database tests)";

export const SHARED_TEST_FIXTURES_DIR = "apps/erp/test/database/fixtures";

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

// Without parent pointers, which nothing here reads: parsing is a third faster.
function parse(file: string, contents: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/**
 * Whether calling `callee` declares a test case: one of `names` with any
 * modifier chain (`it.only`, `it.skipIf(c)`, `it.each\`…\``). `it.extend(…)`,
 * `test.describe` and `regex.test` do not.
 */
function declaresCase(
  callee: ts.Expression,
  names: ReadonlySet<string>
): boolean {
  if (ts.isIdentifier(callee)) return names.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) {
    return (
      MODIFIERS.has(callee.name.text) && declaresCase(callee.expression, names)
    );
  }
  let configured: ts.Expression | undefined;
  if (ts.isCallExpression(callee)) configured = callee.expression;
  if (ts.isTaggedTemplateExpression(callee)) configured = callee.tag;
  return (
    configured !== undefined &&
    ts.isPropertyAccessExpression(configured) &&
    ARG_MODIFIERS.has(configured.name.text) &&
    declaresCase(configured.expression, names)
  );
}

/** Calls `visit` on `node` and every node under it, in source order. */
function eachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => eachNode(child, visit));
}

/** Every call under `node` that declares a test case. */
function caseCalls(
  node: ts.Node,
  names: ReadonlySet<string>
): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  eachNode(node, (child) => {
    if (ts.isCallExpression(child) && declaresCase(child.expression, names)) {
      out.push(child);
    }
  });
  return out;
}

type NamedFunction = { name: string; node: ts.Node; exported: boolean };

/** Every function the file names, at any depth: `function f`, `const f = () =>`. */
function namedFunctions(source: ts.SourceFile): NamedFunction[] {
  const out: NamedFunction[] = [];
  const exported = (node: ts.HasModifiers) =>
    ts
      .getModifiers(node)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  eachNode(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      out.push({ name: node.name.text, node, exported: exported(node) });
    }
    if (!ts.isVariableStatement(node)) return;
    for (const { name, initializer } of node.declarationList.declarations) {
      if (
        ts.isIdentifier(name) &&
        initializer &&
        (ts.isArrowFunction(initializer) ||
          ts.isFunctionExpression(initializer))
      ) {
        out.push({
          name: name.text,
          node: initializer,
          exported: exported(node)
        });
      }
    }
  });
  return out;
}

/**
 * `names` plus each function whose body declares a case of one of them. It
 * repeats until nothing new is found, so a wrapper of a wrapper counts.
 */
function withWrappers(
  names: Iterable<string>,
  functions: NamedFunction[]
): Set<string> {
  const out = new Set(names);
  for (let grew = true; grew; ) {
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
 * The silent guards at the top level of a function's body, or nested only in
 * `try` / `catch` / `finally` blocks (a database test that releases its
 * connection). An `else if` is at the level of its `if`.
 */
function guardsIn(body: ts.Block, source: ts.SourceFile): ts.IfStatement[] {
  const out: ts.IfStatement[] = [];
  let before: ts.Statement | undefined;
  for (const statement of body.statements) {
    if (ts.isTryStatement(statement)) {
      out.push(...guardsIn(statement.tryBlock, source));
      if (statement.catchClause) {
        out.push(...guardsIn(statement.catchClause.block, source));
      }
      if (statement.finallyBlock) {
        out.push(...guardsIn(statement.finallyBlock, source));
      }
    }
    let branch: ts.Statement | undefined = statement;
    while (branch && ts.isIfStatement(branch)) {
      if (
        testsMissing(branch.expression) &&
        returnsNothing(branch.thenStatement) &&
        !narrowsJustAsserted(branch.expression, before, source)
      ) {
        out.push(branch);
      }
      // No statement runs just before an `else if`.
      before = undefined;
      branch = branch.elseStatement;
    }
    before = statement;
  }
  return out;
}

const isNullish = (e: ts.Expression) =>
  e.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isIdentifier(e) && e.text === "undefined");

/**
 * Whether `condition` tests that the thing a case needs is missing: `!x`,
 * `x == null`, `x === undefined`, `typeof x === "undefined"`,
 * `x.length === 0`, alone or in an `||`/`&&` chain.
 */
function testsMissing(condition: ts.Expression): boolean {
  if (ts.isPrefixUnaryExpression(condition)) {
    return condition.operator === ts.SyntaxKind.ExclamationToken;
  }
  if (!ts.isBinaryExpression(condition)) return false;
  const { left, operatorToken, right } = condition;
  switch (operatorToken.kind) {
    case ts.SyntaxKind.BarBarToken:
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return testsMissing(left) || testsMissing(right);
    // `x != null` tests for presence, yet it counts: the text scan before
    // this one counted it, and dropping it would change what the gate reports.
    case ts.SyntaxKind.ExclamationEqualsToken:
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return isNullish(left) || isNullish(right);
    case ts.SyntaxKind.EqualsEqualsToken:
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return (
        isNullish(left) ||
        isNullish(right) ||
        (ts.isTypeOfExpression(left) &&
          ts.isStringLiteral(right) &&
          right.text === "undefined") ||
        (ts.isPropertyAccessExpression(left) &&
          left.name.text === "length" &&
          ts.isNumericLiteral(right) &&
          right.text === "0")
      );
    default:
      return false;
  }
}

/** `return;` or `{ return; }`. */
function returnsNothing(statement: ts.Statement): boolean {
  const only =
    ts.isBlock(statement) && statement.statements.length === 1
      ? statement.statements[0]
      : statement;
  return (
    only !== undefined &&
    ts.isReturnStatement(only) &&
    only.expression === undefined
  );
}

/** `x` in `expect(x).toBe(…)` or `await expect(x).resolves…`. */
function expectedValue(expression: ts.Expression): ts.Expression | undefined {
  let node = expression;
  for (;;) {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "expect")
        return node.arguments[0];
      node = node.expression;
    } else if (
      ts.isAwaitExpression(node) ||
      ts.isPropertyAccessExpression(node)
    ) {
      node = node.expression;
    } else return undefined;
  }
}

/**
 * `expect(result.ok).toBe(true); if (!result.ok) return;` narrows a type: the
 * assertion just before it throws first, so the return is never reached in a
 * passing test.
 */
function narrowsJustAsserted(
  condition: ts.Expression,
  before: ts.Statement | undefined,
  source: ts.SourceFile
): boolean {
  if (
    !ts.isPrefixUnaryExpression(condition) ||
    condition.operator !== ts.SyntaxKind.ExclamationToken ||
    !before ||
    !ts.isExpressionStatement(before)
  )
    return false;
  const asserted = expectedValue(before.expression);
  return asserted?.getText(source) === condition.operand.getText(source);
}

/** The silent guards of each function expression in the file that has one. */
function silentGuards(source: ts.SourceFile): Map<ts.Node, ts.IfStatement[]> {
  const out = new Map<ts.Node, ts.IfStatement[]>();
  eachNode(source, (node) => {
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isBlock(node.body)
    ) {
      const guards = guardsIn(node.body, source);
      if (guards.length > 0) out.set(node, guards);
    }
  });
  return out;
}

/**
 * The `(name, fn)` wrappers the shared fixtures export, found to a fixpoint
 * across files so a wrapper of another file's wrapper counts.
 */
export function sharedTestWrappers(fixtures: SourceFile[]): string[] {
  const files = fixtures.map(({ file, contents }) =>
    namedFunctions(parse(file, contents))
  );
  const found = new Set<string>();
  for (let grew = true; grew; ) {
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

const ABOUT = {
  id: "no-silent-test-pass",
  description:
    "A test case does not return early when what it needs is missing; it skips",
  provenance: {
    deprecates:
      "`if (!client) return;` at the top of a test callback, which reports the case passed without running it",
    replacedBy:
      "`it.skipIf(!client)(…)`, `databaseTest` or `postgrestTest` (.claude/rules/testing.md → Database tests)",
    since: "2026-11-23"
  }
};

/**
 * Fails a bare `return` guarded by a test that a value is missing: `!x`,
 * `x == null`, `x === undefined`, `typeof x === "undefined"`, `x.length === 0`,
 * alone or in an `||`/`&&` chain. Both `if (…) return;` and
 * `if (…) { return; }` count. The `if` (or an `else if` of it) must sit at the
 * top level of a test case's callback, or in a `try`/`catch`/`finally` block
 * there. It reads the parsed TypeScript, so comments, strings and regex
 * literals neither hide a case nor fake one.
 *
 * The incident: `cancel-job.test.ts` wrapped its cases in `cancelTest`, which
 * ran `databaseTest(name, async () => { if (!caller) return; … })`. With no
 * local stack, all five cases passed without running.
 *
 * A test case is one of these:
 * - `it(` or `test(` with any modifier chain (`.only`, `.concurrent`,
 *   `.each(…)(`, `.skipIf(…)(`).
 * - A `(name, fn)` wrapper that `apps/erp/test/database/fixtures/` exports
 *   (`databaseTest`, `postgrestTest`). `sharedTestWrappers` finds them, so a new
 *   wrapper needs no list entry.
 * - A `(name, fn)` wrapper declared in the same file whose body declares a
 *   case. The search repeats until nothing new is found, so a wrapper of a
 *   wrapper counts.
 *
 * Hooks, `describe` and functions nested inside the callback are not read.
 */
export function noSilentTestPass(
  sharedWrappers: readonly string[]
): ConformanceCheck {
  return {
    ...ABOUT,
    scan(file: string, contents: string): Violation[] {
      // Without a `return` there is no guard to find, so the file is not parsed.
      if (!contents.includes("return")) return [];
      const source = parse(file, contents);
      // The guards come first: the wrappers are worked out only for a file
      // that has one.
      const guards = silentGuards(source);
      if (guards.size === 0) return [];
      const names = withWrappers(
        ["it", "test", ...sharedWrappers],
        namedFunctions(source)
      );
      const violations: Violation[] = [];
      for (const call of caseCalls(source, names)) {
        for (const callback of call.arguments) {
          for (const guard of guards.get(callback) ?? []) {
            const start = guard.getStart(source);
            violations.push({
              file,
              line: lineOf(contents, start),
              snippet: contents
                .slice(start, guard.thenStatement.getEnd())
                .replace(/\s+/g, " "),
              message: SILENT_PASS_MESSAGE
            });
          }
        }
      }
      return violations.sort((a, b) => a.line - b.line);
    }
  };
}

export const noSilentTestPassCheck: Check = {
  ...ABOUT,
  find: (repo) =>
    eachFile(
      repo.read(loadTestFiles),
      noSilentTestPass(sharedTestWrappers(repo.read(loadSharedTestFixtures)))
        .scan
    )
};

/** The tests checks, in the order they are written above. */
export const checks: Check[] = [
  testMocksOwnModule,
  testReadsSource,
  noSilentTestPassCheck
];
