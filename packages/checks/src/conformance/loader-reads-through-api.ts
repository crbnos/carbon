// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ts from "typescript5";
import {
  type Check,
  type ConformanceCheck,
  eachFile,
  type SourceFile,
  type Violation
} from "../check";
import { routeTypescript } from "../sources/inputs";
import { loadModuleServerFiles } from "../sources/modules";

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

const ABOUT = {
  id: LOADER_READS_THROUGH_API,
  description:
    "An ERP route loader calls a wrapped building block through its service function, not directly",
  provenance: {
    deprecates:
      "a loader that calls a `.service` building block a service function wraps",
    replacedBy: "`api.<module>.<fn>(input)` from `authorize(request, gate)`",
    since: "2026-10-18"
  }
};

/**
 * An ERP route loader reads through the service functions
 * (`api.<module>.<fn>(input)`, `const { api } = await authorize(request, gate)`), never by calling a
 * building block that a service function wraps: the loader and an API or
 * MCP caller then pass the same permission gate.
 *
 * Only the `loader` is read; actions are not scanned. The baseline holds the
 * reads that stay direct on purpose: service-role reads, reads for another
 * company of the group, reads whose page derives its types from the building
 * block, and the write-on-GET `upsertPickMethod` calls.
 */
export function loaderReadsThroughApi(wrapped: Set<string>): ConformanceCheck {
  return {
    ...ABOUT,
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
      // namespace name -> `<module>`, for `import * as x` of a service file
      const namespaces = new Map<string, string>();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const from = (statement.moduleSpecifier as ts.StringLiteral).text;
        const module = SERVICE_IMPORT.exec(from)?.[1];
        const clause = statement.importClause;
        if (!module || !clause || clause.isTypeOnly) continue;
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named)) {
          namespaces.set(named.name.text, module);
          continue;
        }
        if (!named || !ts.isNamedImports(named)) continue;
        for (const element of named.elements) {
          if (element.isTypeOnly) continue;
          const name = (element.propertyName ?? element.name).text;
          imported.set(element.name.text, `${module}.${name}`);
        }
      }
      const body = loaderBody(source);
      if (!body || imported.size + namespaces.size === 0) return [];

      const calledBlock = (callee: ts.Expression): string | undefined => {
        if (ts.isIdentifier(callee)) return imported.get(callee.text);
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression)
        ) {
          const module = namespaces.get(callee.expression.text);
          if (module) return `${module}.${callee.name.text}`;
        }
        return undefined;
      };

      const violations: Violation[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const block = calledBlock(node.expression);
          if (block && wrapped.has(block)) {
            violations.push({
              file,
              line:
                source.getLineAndCharacterOfPosition(node.getStart(source))
                  .line + 1,
              snippet: block,
              message: `Call ${block} through its service function: api.${block}(input), with api from authorize(request, gate)`
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

export const loaderReadsThroughApiCheck: Check = {
  ...ABOUT,
  find: (repo) =>
    eachFile(
      repo.read(routeTypescript),
      loaderReadsThroughApi(
        wrappedBuildingBlocks(
          repo.read(loadModuleServerFiles).map((f) => f.server)
        )
      ).scan
    )
};
