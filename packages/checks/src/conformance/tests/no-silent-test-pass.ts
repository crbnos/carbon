// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BlockStatement, IfStatement, Program } from "oxc-parser";
import { defineCheck, eachFile, type Violation } from "../../check";
import {
  type Node,
  isNamedMember,
  parseTypescript,
  walk
} from "../../sources/syntax";
import {
  caseCalls,
  loadSharedTestFixtures,
  namedFunctions,
  sharedTestWrappers,
  withWrappers
} from "../../sources/test-cases";
import { loadTestFiles } from "../../sources/test-files";
import { lineOf } from "../../sources/text";

/**
 * vitest reports a case whose callback returns before asserting as PASSED:
 * without a local stack the five cancel-job regressions went green unrun.
 *
 * Fails a bare `return` guarded by a test that a value is missing: `!x`,
 * `x == null`, `x === undefined`, `typeof x === "undefined"`, `x.length === 0`,
 * alone or in an `||`/`&&` chain. Both `if (…) return;` and
 * `if (…) { return; }` count. The `if` (or an `else if` of it) must sit at the
 * top level of a test case's callback, or in a `try`/`catch`/`finally` block
 * there. It reads the parsed tree, so comments, strings and regex
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
export const noSilentTestPass = defineCheck({
  reads: { files: loadTestFiles, fixtures: loadSharedTestFixtures },
  id: "no-silent-test-pass",
  description:
    "A test case does not return early when what it needs is missing; it skips",
  provenance: {
    deprecates:
      "`if (!client) return;` at the top of a test callback, which reports the case passed without running it",
    replacedBy:
      "`it.skipIf(!client)(…)`, `databaseTest` or `postgrestTest` (.claude/rules/testing.md → Database tests)",
    since: "2026-11-23"
  },
  rule() {
    const message =
      "A test that returns early passes without running: use `it.skipIf(!x)(…)` / `databaseTest` so it reports skipped, or assert the value exists (.claude/rules/testing.md → Database tests)";

    const isNullish = (e: Node) =>
      (e.type === "Literal" && e.value === null && e.raw === "null") ||
      (e.type === "Identifier" && e.name === "undefined");

    // Whether `condition` tests that the thing a case needs is missing: `!x`,
    // `x == null`, `x === undefined`, `typeof x === "undefined"`,
    // `x.length === 0`, alone or in an `||`/`&&` chain.
    const testsMissing = (condition: Node): boolean => {
      if (condition.type === "UnaryExpression") {
        return condition.operator === "!";
      }
      if (condition.type === "LogicalExpression") {
        return (
          condition.operator !== "??" &&
          (testsMissing(condition.left) || testsMissing(condition.right))
        );
      }
      if (condition.type !== "BinaryExpression") return false;
      const { left, operator, right } = condition;
      switch (operator) {
        // `x != null` tests for presence, yet it counts: the text scan before
        // this one counted it, and dropping it would change what the gate reports.
        case "!=":
        case "!==":
          return isNullish(left) || isNullish(right);
        case "==":
        case "===":
          return (
            isNullish(left) ||
            isNullish(right) ||
            (left.type === "UnaryExpression" &&
              left.operator === "typeof" &&
              right.type === "Literal" &&
              right.value === "undefined") ||
            (isNamedMember(left) &&
              left.property.name === "length" &&
              right.type === "Literal" &&
              right.value === 0)
          );
        default:
          return false;
      }
    };

    // `return;` or `{ return; }`.
    const returnsNothing = (statement: Node): boolean => {
      const only =
        statement.type === "BlockStatement" && statement.body.length === 1
          ? statement.body[0]
          : statement;
      return only?.type === "ReturnStatement" && only.argument === null;
    };

    // `x` in `expect(x).toBe(…)` or `await expect(x).resolves…`.
    const expectedValue = (expression: Node): Node | undefined => {
      let node = expression;
      for (;;) {
        if (node.type === "CallExpression") {
          if (
            node.callee.type === "Identifier" &&
            node.callee.name === "expect"
          )
            return node.arguments[0];
          node = node.callee;
        } else if (node.type === "AwaitExpression") {
          node = node.argument;
        } else if (isNamedMember(node)) {
          node = node.object;
        } else if (node.type === "ChainExpression") {
          // `expect(x)?.toBe(…)`: the tree wraps an optional chain in one node.
          node = node.expression;
        } else return undefined;
      }
    };

    // `expect(result.ok).toBe(true); if (!result.ok) return;` narrows a type:
    // the assertion just before it throws first, so the return is never
    // reached in a passing test.
    const narrowsJustAsserted = (
      condition: Node,
      before: Node | undefined,
      contents: string
    ): boolean => {
      if (
        condition.type !== "UnaryExpression" ||
        condition.operator !== "!" ||
        before?.type !== "ExpressionStatement"
      )
        return false;
      const asserted = expectedValue(before.expression);
      const textOf = (node: Node) => contents.slice(node.start, node.end);
      return (
        asserted !== undefined &&
        textOf(asserted) === textOf(condition.argument)
      );
    };

    // The silent guards at the top level of a function's body, or nested only
    // in `try` / `catch` / `finally` blocks (a database test that releases its
    // connection). An `else if` is at the level of its `if`.
    const guardsIn = (
      body: BlockStatement,
      contents: string
    ): IfStatement[] => {
      const out: IfStatement[] = [];
      let before: Node | undefined;
      for (const statement of body.body) {
        if (statement.type === "TryStatement") {
          out.push(...guardsIn(statement.block, contents));
          if (statement.handler) {
            out.push(...guardsIn(statement.handler.body, contents));
          }
          if (statement.finalizer) {
            out.push(...guardsIn(statement.finalizer, contents));
          }
        }
        let branch: Node | null = statement;
        while (branch?.type === "IfStatement") {
          if (
            testsMissing(branch.test) &&
            returnsNothing(branch.consequent) &&
            !narrowsJustAsserted(branch.test, before, contents)
          ) {
            out.push(branch);
          }
          // No statement runs just before an `else if`.
          before = undefined;
          branch = branch.alternate;
        }
        before = statement;
      }
      return out;
    };

    // The silent guards of each function expression in the file that has one.
    const silentGuards = (
      program: Program,
      contents: string
    ): Map<Node, IfStatement[]> => {
      const out = new Map<Node, IfStatement[]>();
      walk(program, (node) => {
        if (
          (node.type === "ArrowFunctionExpression" ||
            node.type === "FunctionExpression") &&
          node.body?.type === "BlockStatement"
        ) {
          const guards = guardsIn(node.body, contents);
          if (guards.length > 0) out.set(node, guards);
        }
      });
      return out;
    };

    return ({ files, fixtures }) => {
      const sharedWrappers = sharedTestWrappers(fixtures);
      return eachFile(files, (file, contents) => {
        // Without a `return` there is no guard to find, so the file is not parsed.
        if (!contents.includes("return")) return [];
        const { program } = parseTypescript(file, contents);
        // The guards come first: the wrappers are worked out only for a file
        // that has one.
        const guards = silentGuards(program, contents);
        if (guards.size === 0) return [];
        const names = withWrappers(
          ["it", "test", ...sharedWrappers],
          namedFunctions(program)
        );
        const violations: Violation[] = [];
        for (const call of caseCalls(program, names)) {
          for (const callback of call.arguments) {
            for (const guard of guards.get(callback) ?? []) {
              violations.push({
                file,
                line: lineOf(contents, guard.start),
                snippet: contents
                  .slice(guard.start, guard.consequent.end)
                  .replace(/\s+/g, " "),
                message
              });
            }
          }
        }
        return violations.sort((a, b) => a.line - b.line);
      });
    };
  }
});
