// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Program } from "oxc-parser";
import { defineCheck, eachFile, type Violation } from "../../check";
import { routeTypescript } from "../../sources/inputs";
import {
  loadModuleServerFiles,
  wrappedBuildingBlocks
} from "../../sources/modules";
import { type Node, parseTypescript, walk } from "../../sources/syntax";
import { lineOf } from "../../sources/text";

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
export const loaderReadsThroughApi = defineCheck({
  id: "loader-reads-through-api",
  description:
    "An ERP route loader calls a wrapped building block through its service function, not directly",
  provenance: {
    deprecates:
      "a loader that calls a `.service` building block a service function wraps",
    replacedBy: "`api.<module>.<fn>(input)` from `authorize(request, gate)`",
    since: "2026-10-18"
  },
  reads: { routes: routeTypescript, modules: loadModuleServerFiles },
  rule() {
    const erpRoutes = /^apps\/erp\/app\/routes\//;
    const serviceImport = /modules\/([a-z-]+)\/\1(?:\.ee)?\.service$/;

    /** The `loader` the route declares at its top level, exported or not. */
    const loaderBody = (program: Program): Node | null | undefined => {
      for (const topLevel of program.body) {
        const statement =
          (topLevel.type === "ExportNamedDeclaration" ||
            topLevel.type === "ExportDefaultDeclaration") &&
          topLevel.declaration
            ? topLevel.declaration
            : topLevel;
        if (
          (statement.type === "FunctionDeclaration" ||
            statement.type === "TSDeclareFunction") &&
          statement.id?.name === "loader"
        ) {
          return statement.body;
        }
        if (statement.type === "VariableDeclaration") {
          for (const d of statement.declarations) {
            if (d.id.type === "Identifier" && d.id.name === "loader") {
              return d.init;
            }
          }
        }
      }
      return undefined;
    };

    const scanRoute = (
      wrapped: Set<string>,
      file: string,
      contents: string
    ): Violation[] => {
      if (!erpRoutes.test(file) || !contents.includes(".service")) return [];
      const { program } = parseTypescript(file, contents);
      // local name -> `<module>.<name>`, for value imports of a service file
      const imported = new Map<string, string>();
      // namespace name -> `<module>`, for `import * as x` of a service file
      const namespaces = new Map<string, string>();
      for (const statement of program.body) {
        if (statement.type !== "ImportDeclaration") continue;
        const module = serviceImport.exec(statement.source.value)?.[1];
        if (!module || statement.importKind === "type") continue;
        for (const specifier of statement.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            namespaces.set(specifier.local.name, module);
          }
          if (
            specifier.type !== "ImportSpecifier" ||
            specifier.importKind === "type"
          ) {
            continue;
          }
          const name =
            specifier.imported.type === "Literal"
              ? specifier.imported.value
              : specifier.imported.name;
          imported.set(specifier.local.name, `${module}.${name}`);
        }
      }
      const body = loaderBody(program);
      if (!body || imported.size + namespaces.size === 0) return [];

      const calledBlock = (callee: Node): string | undefined => {
        if (callee.type === "Identifier") return imported.get(callee.name);
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier"
        ) {
          const module = namespaces.get(callee.object.name);
          if (module) return `${module}.${callee.property.name}`;
        }
        return undefined;
      };

      const violations: Violation[] = [];
      walk(body, (node) => {
        if (node.type !== "CallExpression") return;
        const block = calledBlock(node.callee);
        if (block && wrapped.has(block)) {
          violations.push({
            file,
            line: lineOf(contents, node.start),
            snippet: block,
            message: `Call ${block} through its service function: api.${block}(input), with api from authorize(request, gate)`
          });
        }
      });
      return violations;
    };

    return ({ routes, modules }) => {
      const wrapped = wrappedBuildingBlocks(modules.map((f) => f.server));
      return eachFile(routes, (file, contents) =>
        scanRoute(wrapped, file, contents)
      );
    };
  }
});
