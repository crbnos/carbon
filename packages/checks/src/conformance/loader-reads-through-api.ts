// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ts from "typescript";
import type { ConformanceCheck, SourceFile, Violation } from "../check";

const ROUTES = /^apps\/erp\/app\/routes\//;
const SERVER_FILE =
  /^apps\/erp\/app\/modules\/([a-z-]+)\/\1(?:\.ee)?\.server\.ts$/;
const SERVICE_IMPORT = /modules\/([a-z-]+)\/\1(?:\.ee)?\.service$/;

/**
 * `<module>.<name>` for every building block a service function calls
 * (`service.<name>(…)` in `<module>.server.ts`). A building block no service
 * function calls is a helper, and a loader may call it directly.
 */
export function wrappedBuildingBlocks(serverFiles: SourceFile[]): Set<string> {
  const wrapped = new Set<string>();
  for (const { file, contents } of serverFiles) {
    const module = SERVER_FILE.exec(file)?.[1];
    if (!module) continue;
    for (const m of contents.matchAll(/\bservice\.(\w+)\(/g)) {
      wrapped.add(`${module}.${m[1]}`);
    }
  }
  return wrapped;
}

function loaderBody(source: ts.SourceFile): ts.Node | undefined {
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "loader"
    ) {
      return statement.body;
    }
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === "loader")
          return d.initializer;
      }
    }
  }
  return undefined;
}

export const LOADER_READS_THROUGH_API = "loader-reads-through-api";

/**
 * An ERP route loader reads through the service functions
 * (`api.<module>.<fn>(input)`, `api = carbonFor(auth)`), never by calling a
 * building block that a service function wraps: the loader and an API or
 * MCP caller then pass the same permission gate.
 */
export function loaderReadsThroughApi(wrapped: Set<string>): ConformanceCheck {
  return {
    id: LOADER_READS_THROUGH_API,
    description:
      "An ERP route loader calls a wrapped building block through its service function, not directly",
    provenance: {
      deprecates:
        "a loader that calls a `.service` building block a service function wraps",
      replacedBy: "`api.<module>.<fn>(input)` with `api = carbonFor(auth)`",
      since: "2026-10-18"
    },
    scan(file: string, contents: string): Violation[] {
      if (!ROUTES.test(file) || !contents.includes(".service")) return [];
      const source = ts.createSourceFile(
        file,
        contents,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      // local name -> `<module>.<name>`, for value imports of a service file
      const imported = new Map<string, string>();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const from = (statement.moduleSpecifier as ts.StringLiteral).text;
        const module = SERVICE_IMPORT.exec(from)?.[1];
        const clause = statement.importClause;
        if (!module || !clause || clause.isTypeOnly) continue;
        const named = clause.namedBindings;
        if (!named || !ts.isNamedImports(named)) continue;
        for (const element of named.elements) {
          if (element.isTypeOnly) continue;
          const name = (element.propertyName ?? element.name).text;
          imported.set(element.name.text, `${module}.${name}`);
        }
      }
      const body = loaderBody(source);
      if (!body || imported.size === 0) return [];

      const violations: Violation[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const block = imported.get(node.expression.text);
          if (block && wrapped.has(block)) {
            violations.push({
              file,
              line:
                source.getLineAndCharacterOfPosition(node.getStart(source))
                  .line + 1,
              snippet: block,
              message: `Call ${block} through its service function: api.${block}(input), with api = carbonFor(auth)`
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(body);
      return violations;
    }
  };
}
