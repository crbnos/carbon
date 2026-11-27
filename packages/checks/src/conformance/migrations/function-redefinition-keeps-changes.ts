// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node } from "libpg-query";
import { defineCheck, type Violation } from "../../check";
import { migrations } from "../../sources/inputs";
import { nameParts, sqlNodes } from "../../sources/sql";

/**
 * A migration that redefines a function must start from its newest definition.
 * `20261014171619_receive-consumed-serial-units` forked `complete_job_to_inventory`
 * from an older migration, and its `CREATE OR REPLACE` silently undid the two
 * migrations between them: every company posting job costing (always-post) and
 * the lock on the production events a completion posts.
 * `20261015161847_job-receipt-takes-issued-serial-units` restored both.
 *
 * For each redefinition, the lines the previous definition ADDED over its own
 * predecessor must still be in the new body. A rewrite that drops them on
 * purpose goes in the baseline with the reason in its migration header.
 */
export const functionRedefinitionKeepsChanges = defineCheck({
  id: "function-redefinition-keeps-changes",
  description:
    "A migration that redefines a function must start from its newest definition.",
  provenance: {
    deprecates:
      "a CREATE OR REPLACE FUNCTION forked from an older definition, which silently undoes the migrations between them",
    replacedBy:
      "start the redefinition from the newest definition of the function",
    incidents: ["6907343728"]
  },
  reads: { migrations },
  rule() {
    /**
     * Migrations before this one are history; only a new redefinition is checked.
     * It is the migration of the bug the check exists for, so the check covers it.
     */
    const checkedSince = "20261014171619";

    /** Fewer dropped lines than this is a deliberate edit, not a lost change. */
    const minDropped = 2;

    /** The parser's internal type names, as Postgres prints them in a signature. */
    const printedTypes: Record<string, string> = {
      bool: "boolean",
      bpchar: "character",
      float4: "real",
      float8: "double precision",
      int2: "smallint",
      int4: "integer",
      int8: "bigint",
      timestamp: "timestamp without time zone",
      timestamptz: "timestamp with time zone",
      varchar: "character varying"
    };

    /**
     * What identifies a function besides its name: the types of its input
     * arguments (an OUT or TABLE column is not one), as the parser resolves them,
     * so `int` and `integer` are the same function. Argument names, defaults and
     * type modifiers are not part of it.
     */
    function argumentTypes(parameters: Node[] | undefined): string[] {
      return (parameters ?? []).flatMap((parameter) => {
        if (!("FunctionParameter" in parameter)) return [];
        const { mode, argType } = parameter.FunctionParameter;
        if (mode === "FUNC_PARAM_OUT" || mode === "FUNC_PARAM_TABLE") return [];
        const name = nameParts(argType?.names)
          .filter((part) => part !== "pg_catalog" && part !== "public")
          .join(".");
        return [
          (printedTypes[name] ?? name) +
            "[]".repeat(argType?.arrayBounds?.length ?? 0)
        ];
      });
    }

    /**
     * Each `CREATE [OR REPLACE] FUNCTION`, wherever it is written: its signature
     * (schema, name and argument types: an overload is another function), the
     * name a finding shows, and its body lines, comments and blanks left out.
     */
    function functionBodies(
      sql: string
    ): { signature: string; name: string; lines: Set<string> }[] {
      const out: { signature: string; name: string; lines: Set<string> }[] = [];
      for (const { node } of sqlNodes(sql)) {
        if (!("CreateFunctionStmt" in node)) continue;
        const { funcname, parameters, options } = node.CreateFunctionStmt;
        const parts = nameParts(funcname);
        const bare = parts.at(-1) ?? "";
        const schema = parts.length > 1 ? (parts[0] ?? "public") : "public";
        const body = (options ?? []).flatMap((option) =>
          "DefElem" in option && option.DefElem.defname === "as"
            ? nameParts(
                option.DefElem.arg && "List" in option.DefElem.arg
                  ? option.DefElem.arg.List.items
                  : []
              )
            : []
        )[0];
        if (body === undefined) continue;
        out.push({
          signature: `${schema}.${bare}(${argumentTypes(parameters).join(", ")})`,
          name: schema === "public" ? bare : `${schema}.${bare}`,
          lines: new Set(
            body
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 12 && !line.startsWith("--"))
          )
        });
      }
      return out;
    }

    return ({ migrations }) => {
      const definitions = new Map<
        string,
        { name: string; file: string; lines: Set<string> }[]
      >();
      for (const { file, contents } of [...migrations].sort((a, b) =>
        a.file.localeCompare(b.file)
      )) {
        for (const { signature, name, lines } of functionBodies(contents)) {
          const list = definitions.get(signature) ?? [];
          list.push({ name, file, lines });
          definitions.set(signature, list);
        }
      }

      const out: Violation[] = [];
      for (const [signature, list] of definitions) {
        for (let k = 2; k < list.length; k++) {
          const current = list[k];
          const previous = list[k - 1];
          const older = list[k - 2];
          if (!current || !previous || !older) continue;
          if (current.file < checkedSince) continue;
          const dropped = [...previous.lines].filter(
            (line) => !older.lines.has(line) && !current.lines.has(line)
          );
          if (dropped.length < minDropped) continue;
          out.push({
            file: current.file,
            line: 0,
            snippet: `${current.name} drops ${previous.file}`,
            message: `${current.file} redefines ${signature} without ${dropped.length} lines that ${previous.file} added (e.g. "${dropped[0]}"). Start the CREATE OR REPLACE from the newest definition. If the change is removed on purpose, say so in the migration header and baseline this finding.`
          });
        }
      }
      return out;
    };
  }
});
