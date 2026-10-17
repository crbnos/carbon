// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ts from "typescript";
import type { ConformanceCheck, Violation } from "../check";

/**
 * A module's `<module>.server.ts` is its API: every export is a
 * `defineServiceFn` const, published as `<module>_<name>` and called by routes
 * as `api.<module>.<name>(input)`. Anything else — a helper function, a class,
 * an exported constant — is a building block and lives in
 * `<module>.service.ts`. Types and plain (non-function) constants may stay.
 */
const SERVER_FILE =
  /^apps\/erp\/app\/modules\/([a-z-]+)\/\1(?:\.ee)?\.server\.ts$/;

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );

const isDefineServiceFn = (init: ts.Expression | undefined) =>
  !!init &&
  ts.isCallExpression(init) &&
  ts.isIdentifier(init.expression) &&
  init.expression.text === "defineServiceFn";

const isFunctionValue = (init: ts.Expression | undefined) =>
  !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));

export const serviceFnFile: ConformanceCheck = {
  id: "service-fn-file",
  description:
    "A module's <module>.server.ts exports only defineServiceFn consts; every other function lives in <module>.service.ts.",
  provenance: {
    deprecates:
      "helper functions, classes and exported values in a module's server file",
    replacedBy:
      "defineServiceFn consts in <module>.server.ts, building blocks in <module>.service.ts"
  },
  scan(file, contents) {
    const match = SERVER_FILE.exec(file);
    if (!match) return [];
    const module = match[1]!;
    const source = ts.createSourceFile(
      file,
      contents,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const violations: Violation[] = [];
    const flag = (node: ts.Node, name: string, why: string) =>
      violations.push({
        file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        snippet: name,
        message: `${name}: ${why} Move it to ${module}.service.ts; ${module}.server.ts holds only service functions.`
      });

    for (const statement of source.statements) {
      if (
        ts.isImportDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)
      ) {
        continue;
      }
      if (ts.isVariableStatement(statement)) {
        const exported = isExported(statement);
        for (const declaration of statement.declarationList.declarations) {
          const name = declaration.name.getText(source);
          const init = declaration.initializer;
          if (isDefineServiceFn(init)) {
            if (!exported) {
              flag(declaration, name, "a service function nothing can call.");
            }
          } else if (isFunctionValue(init)) {
            flag(declaration, name, "a function, not a service function.");
          } else if (exported) {
            flag(
              declaration,
              name,
              "an export that is not a service function."
            );
          }
        }
        continue;
      }
      const name =
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name
          ? statement.name.text
          : ts.SyntaxKind[statement.kind];
      flag(statement, name, "not a service function.");
    }
    return violations;
  }
};
