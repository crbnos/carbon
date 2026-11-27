// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  BindingPattern,
  CallExpression,
  Directive,
  Expression,
  ObjectProperty,
  Statement
} from "oxc-parser";
import { defineCheck, type Violation } from "../../check";
import { typescript } from "../../sources/inputs";
import { declarationOf, parseTypescript } from "../../sources/syntax";
import { lineOf } from "../../sources/text";

/**
 * A module's `<module>.server.ts` (or `<module>.ee.server.ts`) is its API: every export is a
 * `defineServiceFn` const, published as `<module>_<name>` and called by routes
 * as `api.<module>.<name>(input)`. Anything else — a helper function, a class,
 * an exported constant — is a building block and lives in
 * `<module>.service.ts`. Types and plain (non-function) constants may stay.
 */
export const serviceFnFile = defineCheck({
  files: typescript,
  id: "service-fn-file",
  description:
    "A module's <module>.server.ts exports only defineServiceFn consts; every other function lives in <module>.service.ts.",
  provenance: {
    deprecates:
      "helper functions, classes and exported values in a module's server file",
    replacedBy:
      "defineServiceFn consts in <module>.server.ts, building blocks in <module>.service.ts"
  },
  rule() {
    const serverFile =
      /^apps\/erp\/app\/modules\/([a-z-]+)\/\1(?:\.ee)?\.server\.ts$/;

    const isDefineServiceFn = (
      init: Expression | null
    ): init is CallExpression =>
      init?.type === "CallExpression" &&
      init.callee.type === "Identifier" &&
      init.callee.name === "defineServiceFn";

    /** The `permission: {}` of a service function's definition, if it has one. */
    const emptyPermission = (call: CallExpression) => {
      const definition = call.arguments[0];
      if (definition?.type !== "ObjectExpression") return null;
      const property = definition.properties.find(
        (p): p is ObjectProperty =>
          p.type === "Property" &&
          p.kind === "init" &&
          !p.method &&
          !p.shorthand &&
          !p.computed &&
          p.key.type === "Identifier" &&
          p.key.name === "permission"
      );
      const value = property?.value;
      return value?.type === "ObjectExpression" && value.properties.length === 0
        ? value
        : null;
    };

    const isFunctionValue = (init: Expression | null) =>
      init?.type === "ArrowFunctionExpression" ||
      init?.type === "FunctionExpression";

    /** A binding as written, without its type annotation (`x`, `{ a, b }`). */
    const bindingText = (contents: string, id: BindingPattern) =>
      id.type === "Identifier"
        ? id.name
        : contents
            .slice(id.start, id.typeAnnotation?.start ?? id.end)
            .trimEnd();

    // The name a finding gives a statement that declares nothing it can name.
    // The check reported TypeScript's own names for these, so they are kept.
    const statementNames: Record<string, string> = {
      ExportNamedDeclaration: "ExportDeclaration",
      ExportAllDeclaration: "ExportDeclaration",
      ExportDefaultDeclaration: "ExportAssignment",
      TSExportAssignment: "ExportAssignment",
      TSNamespaceExportDeclaration: "NamespaceExportDeclaration",
      TSImportEqualsDeclaration: "ImportEqualsDeclaration",
      TSModuleDeclaration: "ModuleDeclaration",
      TSGlobalDeclaration: "ModuleDeclaration",
      TSDeclareFunction: "FunctionDeclaration",
      BlockStatement: "Block",
      DoWhileStatement: "DoStatement"
    };

    const statementName = (node: Directive | Statement) => {
      if (
        (node.type === "FunctionDeclaration" ||
          node.type === "TSDeclareFunction" ||
          node.type === "ClassDeclaration" ||
          node.type === "TSEnumDeclaration") &&
        node.id
      )
        return node.id.name;
      return statementNames[node.type] ?? node.type;
    };

    return (file, contents) => {
      const module = serverFile.exec(file)?.[1];
      if (!module) return [];
      const { program } = parseTypescript(file, contents);
      const violations: Violation[] = [];
      const flag = (at: number, name: string, why: string) =>
        violations.push({
          file,
          line: lineOf(contents, at),
          snippet: name,
          message: `${name}: ${why} Move it to ${module}.service.ts; ${module}.server.ts holds only service functions.`
        });

      for (const statement of program.body) {
        const { node, exported } = declarationOf(statement);
        if (
          node.type === "ImportDeclaration" ||
          node.type === "TSTypeAliasDeclaration" ||
          node.type === "TSInterfaceDeclaration"
        ) {
          continue;
        }
        if (node.type === "VariableDeclaration") {
          for (const declaration of node.declarations) {
            const name = bindingText(contents, declaration.id);
            const init = declaration.init;
            if (isDefineServiceFn(init)) {
              if (!exported) {
                flag(
                  declaration.start,
                  name,
                  "a service function nothing can call."
                );
              }
              const empty = emptyPermission(init);
              if (empty) {
                violations.push({
                  file,
                  line: lineOf(contents, empty.start),
                  snippet: `${name}: permission {}`,
                  message: `${name}: permission {} reads as "nothing required". Write "employee" for any employee of the company.`
                });
              }
            } else if (isFunctionValue(init)) {
              flag(
                declaration.start,
                name,
                "a function, not a service function."
              );
            } else if (exported) {
              flag(
                declaration.start,
                name,
                "an export that is not a service function."
              );
            }
          }
          continue;
        }
        flag(statement.start, statementName(node), "not a service function.");
      }
      return violations;
    };
  }
});
