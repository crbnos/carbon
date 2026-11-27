// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CallExpression,
  Function as FunctionNode,
  ParamPattern,
  Program
} from "oxc-parser";
import { defineCheck, type Violation } from "../../check";
import { loadDbTableColumns } from "../../sources/db-columns";
import { loadModuleServerFiles } from "../../sources/modules";
import {
  isNamedMember,
  type Node,
  parseTypescript,
  walk
} from "../../sources/syntax";
import { lineOf } from "../../sources/text";

// A service function's `payload(ctx, value)…forCreate()` (or `forUpdate`,
// `forUpsert`, `for(op)`, `build`) adds identity fields to the payload it
// hands a building block. When the building block
// spreads that payload into a write, every added field is a column of the
// write: one the table does not have fails the whole statement (PGRST204),
// and `createdBy` added to a payload that only ever reaches an `.update(`
// rewrites the row's author on every save. Both shipped: `createAccount`
// stamped `companyId` onto the group-scoped `account`, `upsertItemCost`
// restamped `createdBy` on each cost edit.
//
// Follows each `payload(...)` chain in `<module>.server.ts` into the `service.<fn>(...)`
// it is passed to, finds that function in `<module>.service.ts`, and reads
// the writes whose row is the parameter itself (`insert([p])`, `...p`,
// `sanitize(p)`, or one local initialized from it). A field of a nested object
// (`...p.contact`) is never added by `payload`, so it is not followed.
//
// The added fields follow `payload`'s own rules: a list gets only `createdBy`,
// and `forUpdate` drops `createdBy`.
export const stampMatchesColumns = defineCheck({
  id: "stamp-matches-columns",
  description:
    "A service function's `payload(ctx, value)…forCreate()` (or `forUpdate`, `forUpsert`, `for(op)`, `build`) adds identity fields to the payload it hands a building block.",
  reads: { modules: loadModuleServerFiles, columns: loadDbTableColumns },
  rule() {
    function contains(outer: Node, inner: Node): boolean {
      return inner.start >= outer.start && inner.end <= outer.end;
    }

    function topLevelFunctions(program: Program): Map<string, FunctionNode> {
      const out = new Map<string, FunctionNode>();
      for (const statement of program.body) {
        const declaration =
          statement.type === "ExportNamedDeclaration" ||
          statement.type === "ExportDefaultDeclaration"
            ? statement.declaration
            : statement;
        if (declaration?.type === "FunctionDeclaration" && declaration.id) {
          out.set(declaration.id.name, declaration);
        }
      }
      return out;
    }

    /**
     * The name and type of a parameter that is one name: `p`, `p: T`,
     * `p: T = v` or `...p: T`. A destructured parameter has no one name.
     */
    function namedParameter(
      param: ParamPattern
    ): { name: string; type?: Node } | undefined {
      if (param.type === "Identifier") {
        return { name: param.name, type: param.typeAnnotation?.typeAnnotation };
      }
      if (
        param.type === "AssignmentPattern" &&
        param.left.type === "Identifier"
      ) {
        return {
          name: param.left.name,
          type: param.left.typeAnnotation?.typeAnnotation
        };
      }
      if (
        param.type === "RestElement" &&
        param.argument.type === "Identifier"
      ) {
        return {
          name: param.argument.name,
          type: param.typeAnnotation?.typeAnnotation
        };
      }
      return undefined;
    }

    const terminals: Record<string, { fields: string[]; operation?: string }> =
      {
        forCreate: { fields: ["createdBy"], operation: "create" },
        forUpdate: { fields: ["updatedBy"], operation: "update" },
        forUpsert: { fields: ["createdBy", "updatedBy"] },
        for: { fields: ["createdBy", "updatedBy"] },
        build: { fields: [] }
      };

    /**
     * The fields and operation of a `payload(ctx, value).<modifiers>.<terminal>()`
     * chain, read off its calls; undefined for any other node.
     */
    function payloadChain(
      node: Node
    ): { fields: string[]; operation?: string } | undefined {
      if (node.type !== "CallExpression" || !isNamedMember(node.callee)) {
        return undefined;
      }
      const name = node.callee.property.name;
      const terminal = Object.hasOwn(terminals, name)
        ? terminals[name]
        : undefined;
      if (!terminal) return undefined;
      const fields = new Set(["companyId", ...terminal.fields]);
      const operation =
        name === "for" ? stringValue(node.arguments[0]) : terminal.operation;
      let inner: Node = node.callee.object;
      while (inner.type === "CallExpression" && isNamedMember(inner.callee)) {
        const modifier = inner.callee.property.name;
        if (modifier === "withGroup") fields.add("companyGroupId");
        else if (modifier === "withUser") fields.add("userId");
        else if (modifier === "withoutCompany") fields.delete("companyId");
        else return undefined;
        inner = inner.callee.object;
      }
      if (
        inner.type !== "CallExpression" ||
        inner.callee.type !== "Identifier" ||
        inner.callee.name !== "payload"
      ) {
        return undefined;
      }
      return { fields: [...fields], operation };
    }

    /** The value of a `"…"` string literal; a template literal is not one. */
    function stringValue(node: Node | undefined): string | undefined {
      return node?.type === "Literal" && typeof node.value === "string"
        ? node.value
        : undefined;
    }

    const isFunction = (node: Node) =>
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression";

    /**
     * The `service.<name>(…)` call the stamped value is an argument of: the
     * nearest of its `ancestors`, unless a function lies between them.
     */
    function enclosingServiceCall(
      ancestors: Node[]
    ): { call: CallExpression; name: string } | undefined {
      for (const n of ancestors.toReversed()) {
        if (
          n.type === "CallExpression" &&
          isNamedMember(n.callee) &&
          n.callee.object.type === "Identifier" &&
          n.callee.object.name === "service"
        ) {
          return { call: n, name: n.callee.property.name };
        }
        if (isFunction(n)) return undefined;
      }
      return undefined;
    }

    /** The name of the nearest variable the stamped value is declared in. */
    function leafName(ancestors: Node[]): string {
      for (const n of ancestors.toReversed()) {
        if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
          return n.id.name;
        }
      }
      return "?";
    }

    /** Writes whose row is `param` itself, with their table. */
    function carriedWrites(
      body: Node,
      param: string,
      contents: string
    ): { table: string; verb: string }[] {
      const out: { table: string; verb: string }[] = [];
      const textOf = (node: Node) => contents.slice(node.start, node.end);
      const carriesName = (arg: Node, name: string) => {
        const text = textOf(arg).replace(/\s+/g, "");
        return (
          text === name ||
          text === `[${name}]` ||
          new RegExp(`\\.\\.\\.(sanitize\\()?${name}(?![.\\w])`).test(text) ||
          text.includes(`sanitize(${name})`)
        );
      };
      // One level of aliasing: `const data = sanitize(param)` carries it too.
      const names = [param];
      walk(body, (node) => {
        if (
          node.type === "VariableDeclarator" &&
          node.id.type === "Identifier" &&
          node.init &&
          carriesName(node.init, param)
        ) {
          names.push(node.id.name);
        }
      });
      const carries = (arg: Node) =>
        names.some((name) => carriesName(arg, name));
      walk(body, (node) => {
        if (node.type !== "CallExpression" || !isNamedMember(node.callee))
          return;
        const verb = node.callee.property.name;
        const [row] = node.arguments;
        if (
          !["insert", "update", "upsert"].includes(verb) ||
          !row ||
          !carries(row)
        ) {
          return;
        }
        const table = fromTable(node.callee.object, contents);
        if (table) out.push({ table, verb });
      });
      return out;
    }

    /**
     * The `.from("t")` at the root of a builder chain, never `storage.from`. The
     * walk passes `(…)` and `as T`, and the `?.` chain a pair of parentheses
     * closes.
     */
    function fromTable(node: Node, contents: string): string | undefined {
      let n: Node = node;
      for (;;) {
        if (n.type === "CallExpression") {
          const callee = n.callee;
          if (
            isNamedMember(callee) &&
            callee.property.name === "from" &&
            !contents
              .slice(callee.object.start, callee.object.end)
              .endsWith("storage")
          ) {
            return stringValue(n.arguments[0]);
          }
          n = callee;
        } else if (isNamedMember(n)) {
          n = n.object;
        } else if (
          n.type === "ParenthesizedExpression" ||
          n.type === "TSAsExpression" ||
          n.type === "ChainExpression"
        ) {
          n = n.expression;
        } else {
          return undefined;
        }
      }
    }

    return ({ modules, columns }) => {
      const out: Violation[] = [];
      for (const { server, service } of modules) {
        const serviceFns = topLevelFunctions(
          parseTypescript(service.file, service.contents).program
        );
        const serverTree = parseTypescript(
          server.file,
          server.contents
        ).program;
        walk(serverTree, (node, ancestors) => {
          const chain = payloadChain(node);
          if (!chain) return;
          const { fields, operation } = chain;
          const outer = enclosingServiceCall(ancestors);
          if (!outer) return;
          const fn = serviceFns.get(outer.name);
          const index = outer.call.arguments.findIndex((a) =>
            contains(a, node)
          );
          const param = fn?.params[index];
          const named = param ? namedParameter(param) : undefined;
          if (!fn?.body || !named) return;
          const type = named.type
            ? service.contents.slice(named.type.start, named.type.end)
            : "";
          const isList = /\[\]\s*$|^\s*Array</.test(type);
          const added = fields.filter((field) =>
            field === "createdBy"
              ? operation !== "update"
              : isList
                ? false
                : field === "updatedBy"
                  ? operation !== "create"
                  : true
          );
          const writes = carriedWrites(fn.body, named.name, service.contents);
          if (writes.length === 0) return;
          const line = lineOf(server.contents, node.start);
          const leaf = leafName(ancestors);
          for (const table of new Set(writes.map((write) => write.table))) {
            const missing = added.filter((f) => !columns.get(table)?.has(f));
            if (columns.has(table) && missing.length > 0) {
              out.push({
                file: server.file,
                line,
                snippet: `${leaf} ${table} ${missing.join(",")}`,
                message: `${leaf} stamps ${missing.join(", ")} onto a row of "${table}", which has no such column: the write fails. Stamp only the fields the table has.`
              });
            }
          }
          if (
            added.includes("createdBy") &&
            writes.every((write) => write.verb === "update")
          ) {
            out.push({
              file: server.file,
              line,
              snippet: `${leaf} createdBy-on-update`,
              message: `${leaf} stamps createdBy onto a payload that only reaches an update, which rewrites the row's author. Stamp updatedBy instead.`
            });
          }
        });
      }
      return out;
    };
  }
});
