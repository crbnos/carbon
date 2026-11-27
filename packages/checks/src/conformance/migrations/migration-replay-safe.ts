// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node } from "libpg-query";
import { defineCheck, type Violation } from "../../check";
import { migrations } from "../../sources/inputs";
import { GENERATED_AUTHZ_MIGRATION } from "../../sources/migrations";
import {
  ancestorsOf,
  nameParts,
  nodesIn,
  relationName,
  type SqlBody,
  type SqlFragment,
  type SqlStatement,
  sqlFragments,
  tokensFrom
} from "../../sources/sql";

// The deploy runner (`ci/src/migrations.ts`, `supabase db push --include-all`)
// re-runs a failed migration over what it already committed: a migration may
// commit part way, for example after `ALTER TYPE … ADD VALUE`. A statement that
// errors on an object already there, or already gone, then fails every deploy
// until someone edits the applied file (`cb75027fc2`, `25243520b4`,
// `11a7a60999`, `f47e4a25bf`).
//
// The check reads the parsed statements that run when the migration is
// applied (`migrationSteps`). A `DROP` without `IF EXISTS` is reported once,
// by the DROP rule, never again at the `CREATE` after it. Only an earlier
// `DROP` with the same name makes a `CREATE` safe. A generated authz
// migration is skipped: it drops every policy of a table first.
//
// Out of scope:
//  - A guard on the wrong key. `751aea1a2b`'s `INSERT … WHERE NOT EXISTS`
//    tested `accountType` while the unique key is the name, so it failed on
//    its first run, not on a re-run. Requiring `ON CONFLICT` on every
//    `INSERT` would catch it, but adds many false positives.
//  - Assumptions about the data: a unique index over duplicate rows
//    (`5d02351492`), or chart groups that were renamed (`11a7a60999`).

export const migrationReplaySafe = defineCheck({
  files: migrations,
  id: "migration-replay-safe",
  description:
    "Every migration statement must succeed when the migration is re-run over a failed deploy's partial state.",
  provenance: {
    deprecates: 'CREATE TABLE "x" / ADD COLUMN "y" / DROP CONSTRAINT "z"',
    replacedBy:
      'CREATE TABLE IF NOT EXISTS "x" / ADD COLUMN IF NOT EXISTS "y" / DROP CONSTRAINT IF EXISTS "z"',
    since: "after 20261119125737_job-wip-balance.sql",
    incidents: ["f47e4a25bf", "cb75027fc2"]
  },
  rule() {
    /**
     * Migrations up to the one `since` names are applied history and cannot be
     * edited. It was the newest migration when the rule was written. After the
     * 2026-06 idempotency pass (`c64c3be9a5`), many older migrations still broke
     * the rule, and a sample of them had no false positives. Applied history
     * cannot change, so they are not checked and have no baseline entries.
     */
    const lastUnchecked = /\d{14}/.exec(
      migrationReplaySafe.provenance?.since ?? ""
    )?.[0];
    if (lastUnchecked === undefined)
      throw new Error(
        "migration-replay-safe: provenance.since must contain the 14-digit migration timestamp"
      );

    /** `"public".x` and `x` are one object. */
    function objectName(parts: string[]): string {
      return parts.length === 2 && parts[0] === "public"
        ? (parts[1] ?? "")
        : parts.join(".");
    }

    type Dropped = { kind: string; name: string; table?: string };

    /** What a DROP statement drops, whether or not it says IF EXISTS. */
    function droppedBy(node: Node): Dropped[] {
      if ("AlterTableStmt" in node) {
        const table = relationName(node.AlterTableStmt.relation ?? {});
        return (node.AlterTableStmt.cmds ?? []).flatMap((cmd) => {
          if (!("AlterTableCmd" in cmd)) return [];
          const { subtype, name = "" } = cmd.AlterTableCmd;
          if (subtype === "AT_DropConstraint") {
            return [{ kind: "CONSTRAINT", name, table }];
          }
          if (subtype === "AT_DropColumn")
            return [{ kind: "COLUMN", name, table }];
          return [];
        });
      }
      if (!("DropStmt" in node)) return [];
      const kind = (node.DropStmt.removeType ?? "").replace("OBJECT_", "");
      return (node.DropStmt.objects ?? []).map((object) => {
        const parts =
          "List" in object
            ? nameParts(object.List.items)
            : "TypeName" in object
              ? nameParts(object.TypeName.names)
              : "ObjectWithArgs" in object
                ? nameParts(object.ObjectWithArgs.objname)
                : "String" in object
                  ? [object.String.sval ?? ""]
                  : [];
        // A trigger or policy is named on its table: `DROP POLICY p ON t`.
        if (kind === "TRIGGER" || kind === "POLICY" || kind === "RULE") {
          return {
            kind,
            name: parts.at(-1) ?? "",
            table: objectName(parts.slice(0, -1))
          };
        }
        return { kind, name: objectName(parts) };
      });
    }

    const DROP_KINDS = new Map([
      ["TABLE", "TABLE"],
      ["VIEW", "VIEW"],
      ["MATVIEW", "MATERIALIZED VIEW"],
      ["FUNCTION", "FUNCTION"],
      ["TRIGGER", "TRIGGER"],
      ["INDEX", "INDEX"],
      ["TYPE", "TYPE"],
      ["POLICY", "POLICY"],
      ["SEQUENCE", "SEQUENCE"],
      ["SCHEMA", "SCHEMA"],
      ["CONSTRAINT", "CONSTRAINT"],
      ["COLUMN", "COLUMN"]
    ]);

    function dropsWithoutIfExists(node: Node): Dropped[] {
      if ("DropStmt" in node)
        return node.DropStmt.missing_ok ? [] : droppedBy(node);
      if (!("AlterTableStmt" in node)) return [];
      const table = relationName(node.AlterTableStmt.relation ?? {});
      return (node.AlterTableStmt.cmds ?? []).flatMap((cmd) => {
        if (!("AlterTableCmd" in cmd) || cmd.AlterTableCmd.missing_ok)
          return [];
        return droppedBy({
          AlterTableStmt: { relation: { relname: table }, cmds: [cmd] }
        });
      });
    }

    type Created = {
      /** How the snippet names the statement: `CREATE TABLE`, `ADD COLUMN`. */
      what: string;
      name: string;
      /** The table it lives on, when it has one. */
      table?: string;
      /** The DROP kinds that, earlier in the file, make creating it again safe. */
      undoneBy: string[];
      /** Where it is written, when the parser keeps that; else the statement's line is used. */
      location?: number;
      message: string;
    };

    const VIEW_LIKE = ["VIEW", "MATVIEW", "FUNCTION", "PROCEDURE"];

    /** What a statement creates that is not there on the first run and is on a re-run. */
    function createdBy(node: Node): Created[] {
      if ("IndexStmt" in node) {
        const { idxname, if_not_exists, relation } = node.IndexStmt;
        // An unnamed index (`CREATE INDEX ON t`) gets a new name on a re-run, so
        // it does not fail.
        if (!idxname || if_not_exists) return [];
        return [
          {
            what: "CREATE INDEX",
            name: idxname,
            table: relationName(relation ?? {}),
            undoneBy: ["INDEX"],
            message: `CREATE INDEX ${idxname} has no IF NOT EXISTS: on a re-run after a failed deploy the index is already there and the migration fails again.`
          }
        ];
      }
      if ("CreateStmt" in node || "CreateTableAsStmt" in node) {
        const table =
          "CreateStmt" in node
            ? node.CreateStmt
            : {
                relation: node.CreateTableAsStmt.into?.rel,
                if_not_exists: node.CreateTableAsStmt.if_not_exists
              };
        const materialized =
          "CreateTableAsStmt" in node &&
          node.CreateTableAsStmt.objtype === "OBJECT_MATVIEW";
        // A temp table is new in every session.
        if (table.if_not_exists || table.relation?.relpersistence === "t")
          return [];
        const name = relationName(table.relation ?? {});
        if (materialized) {
          return [
            {
              what: "CREATE MATERIALIZED VIEW",
              name,
              undoneBy: VIEW_LIKE,
              message: `CREATE of ${name} has no OR REPLACE and no earlier DROP … IF EXISTS: on a re-run after a failed deploy it is already there and the migration fails again.`
            }
          ];
        }
        return [
          {
            what: "CREATE TABLE",
            name,
            undoneBy: ["TABLE"],
            message: `CREATE TABLE ${name} has no IF NOT EXISTS: on a re-run after a failed deploy the table is already there and the migration fails again.`
          }
        ];
      }
      if ("CreateSchemaStmt" in node || "CreateSeqStmt" in node) {
        const [what, name, exists] =
          "CreateSchemaStmt" in node
            ? [
                "CREATE SCHEMA",
                node.CreateSchemaStmt.schemaname ?? "",
                node.CreateSchemaStmt.if_not_exists
              ]
            : [
                "CREATE SEQUENCE",
                relationName(node.CreateSeqStmt.sequence ?? {}),
                node.CreateSeqStmt.if_not_exists
              ];
        if (exists) return [];
        return [
          {
            what,
            name,
            undoneBy: [],
            message: `CREATE of ${name} has no IF NOT EXISTS: on a re-run after a failed deploy it is already there and the migration fails again.`
          }
        ];
      }
      const typeName =
        "CreateEnumStmt" in node
          ? node.CreateEnumStmt.typeName
          : "CompositeTypeStmt" in node
            ? [
                {
                  String: {
                    sval: relationName(node.CompositeTypeStmt.typevar ?? {})
                  }
                }
              ]
            : "CreateRangeStmt" in node
              ? node.CreateRangeStmt.typeName
              : "DefineStmt" in node && node.DefineStmt.kind === "OBJECT_TYPE"
                ? node.DefineStmt.defnames
                : undefined;
      if (typeName) {
        const name = objectName(nameParts(typeName));
        return [
          {
            what: "CREATE TYPE",
            name,
            undoneBy: ["TYPE"],
            message: `CREATE TYPE ${name} fails on a re-run after a failed deploy: the type is already there. CREATE TYPE has no IF NOT EXISTS; create it in a DO block that checks pg_type first, or catches duplicate_object.`
          }
        ];
      }
      if ("AlterEnumStmt" in node) {
        const {
          typeName: names,
          newVal,
          oldVal,
          skipIfNewValExists
        } = node.AlterEnumStmt;
        // RENAME VALUE names an old value; ADD VALUE does not.
        if (!newVal || oldVal || skipIfNewValExists) return [];
        const name = objectName(nameParts(names));
        return [
          {
            what: "ALTER TYPE",
            name,
            undoneBy: [],
            message: `ALTER TYPE ${name} ADD VALUE has no IF NOT EXISTS: on a re-run after a failed deploy the value is already there and the migration fails again.`
          }
        ];
      }
      if ("ViewStmt" in node || "CreateFunctionStmt" in node) {
        const [what, name, replace] =
          "ViewStmt" in node
            ? [
                "CREATE VIEW",
                relationName(node.ViewStmt.view ?? {}),
                node.ViewStmt.replace
              ]
            : [
                node.CreateFunctionStmt.is_procedure
                  ? "CREATE PROCEDURE"
                  : "CREATE FUNCTION",
                objectName(nameParts(node.CreateFunctionStmt.funcname)),
                node.CreateFunctionStmt.replace
              ];
        if (replace) return [];
        return [
          {
            what,
            name,
            undoneBy: VIEW_LIKE,
            message: `CREATE of ${name} has no OR REPLACE and no earlier DROP … IF EXISTS: on a re-run after a failed deploy it is already there and the migration fails again.`
          }
        ];
      }
      if ("AlterTableStmt" in node) {
        const table = relationName(node.AlterTableStmt.relation ?? {});
        return (node.AlterTableStmt.cmds ?? []).flatMap((cmd): Created[] => {
          if (!("AlterTableCmd" in cmd)) return [];
          const { subtype, def, missing_ok } = cmd.AlterTableCmd;
          if (subtype === "AT_AddColumn" && def && "ColumnDef" in def) {
            if (missing_ok) return [];
            const name = def.ColumnDef.colname ?? "";
            return [
              {
                what: "ADD COLUMN",
                name,
                table,
                undoneBy: [],
                location: def.ColumnDef.location,
                message: `ADD COLUMN ${name} has no IF NOT EXISTS: on a re-run after a failed deploy the column is already there and the migration fails again.`
              }
            ];
          }
          if (subtype === "AT_AddConstraint" && def && "Constraint" in def) {
            const name = def.Constraint.conname;
            if (!name) return [];
            return [
              {
                what: "ADD CONSTRAINT",
                name,
                table,
                undoneBy: ["CONSTRAINT"],
                location: def.Constraint.location,
                message: `ADD CONSTRAINT ${name} fails on a re-run after a failed deploy: the constraint is already there. Drop it first with DROP CONSTRAINT IF EXISTS, or add it in a DO block that checks pg_constraint.`
              }
            ];
          }
          return [];
        });
      }
      if ("CreatePolicyStmt" in node) {
        const name = node.CreatePolicyStmt.policy_name ?? "";
        return [
          {
            what: "CREATE POLICY",
            name,
            table: relationName(node.CreatePolicyStmt.table ?? {}),
            undoneBy: ["POLICY"],
            message: `CREATE POLICY ${name} fails on a re-run after a failed deploy: the policy is already there. Precede it with DROP POLICY IF EXISTS on the same table.`
          }
        ];
      }
      if ("CreateTrigStmt" in node) {
        const { trigname: name = "", relation, replace } = node.CreateTrigStmt;
        if (replace) return [];
        return [
          {
            what: "CREATE TRIGGER",
            name,
            table: relationName(relation ?? {}),
            undoneBy: ["TRIGGER"],
            message: `CREATE TRIGGER ${name} fails on a re-run after a failed deploy: the trigger is already there. Precede it with DROP TRIGGER IF EXISTS on the same table, or write CREATE OR REPLACE TRIGGER.`
          }
        ];
      }
      return [];
    }

    /**
     * Whether a statement writes only what is missing: it has a `NOT EXISTS` /
     * `NOT IN (SELECT …)`, an anti-join (`LEFT JOIN … WHERE x.id IS NULL`) or an
     * `EXCEPT`. Read over the whole statement, since the test may sit in a CTE
     * beside the INSERT.
     */
    function readsOnlyMissing(statement: Node): boolean {
      for (const found of nodesIn(statement)) {
        const { node } = found;
        if ("NullTest" in node && node.NullTest.nulltesttype === "IS_NULL") {
          return true;
        }
        if ("SelectStmt" in node && node.SelectStmt.op === "SETOP_EXCEPT") {
          return true;
        }
        if (!("SubLink" in node)) continue;
        for (const parent of ancestorsOf(found)) {
          if ("BoolExpr" in parent && parent.BoolExpr.boolop === "NOT_EXPR") {
            return true;
          }
        }
      }
      return false;
    }

    /** The tables a `DELETE FROM` or `TRUNCATE` empties: a wipe and reseed repeats safely. */
    function wipedBy(node: Node): string[] {
      if ("DeleteStmt" in node) {
        return [relationName(node.DeleteStmt.relation ?? {})];
      }
      if ("TruncateStmt" in node) {
        return (node.TruncateStmt.relations ?? []).flatMap((relation) =>
          "RangeVar" in relation ? [relationName(relation.RangeVar)] : []
        );
      }
      return [];
    }

    /**
     * Whether a DO block decides for itself what to run: it has an IF, a CASE or
     * an EXCEPTION handler. Such a block is trusted whole. A body the PL/pgSQL
     * parser could not read is trusted too: its structure is not known.
     */
    function guards(body: SqlBody): boolean {
      if (body.plpgsql === undefined) return true;
      const guarded = (tree: unknown): boolean => {
        if (Array.isArray(tree)) return tree.some(guarded);
        if (tree === null || typeof tree !== "object") return false;
        return Object.entries(tree).some(
          ([key, value]) =>
            key === "PLpgSQL_stmt_if" ||
            key === "PLpgSQL_stmt_case" ||
            key === "exceptions" ||
            guarded(value)
        );
      };
      return guarded(body.plpgsql);
    }

    type Step = {
      statement: SqlStatement;
      fragment: SqlFragment;
      /** In a guarded DO block: its statements are not checked, but still count as earlier. */
      trusted: boolean;
    };

    /**
     * The statements that run when the migration is applied, in file order: the
     * file's own, and those of its DO blocks. A function body runs when called,
     * not at migration time.
     */
    function migrationSteps(contents: string): Step[] {
      const steps: Step[] = [];
      for (const fragment of sqlFragments(contents)) {
        if (fragment.inside.some((body) => !("DoStmt" in body.statement)))
          continue;
        const trusted = fragment.inside.some(guards);
        for (const statement of fragment.statements) {
          steps.push({ statement, fragment, trusted });
        }
      }
      // Fragments come file first, then bodies; lines put them back in order.
      return steps
        .map((step, index) => ({ step, index }))
        .sort(
          (a, b) =>
            a.step.statement.line - b.step.statement.line || a.index - b.index
        )
        .map(({ step }) => step);
    }

    function alterCommands(node: Node): Node[] {
      if (!("AlterTableStmt" in node)) return [node];
      return (node.AlterTableStmt.cmds ?? []).map((cmd) => ({
        AlterTableStmt: { ...node.AlterTableStmt, cmds: [cmd] }
      }));
    }

    const quote = (name: string) => `"${name}"`;

    /** `CREATE INDEX "i" ON "t"`: an index, policy or trigger is named with its table. */
    const NAMED_ON_TABLE = new Set([
      "CREATE INDEX",
      "CREATE POLICY",
      "CREATE TRIGGER"
    ]);
    function named(what: string, name: string, table: string | undefined) {
      return table && NAMED_ON_TABLE.has(what)
        ? `${what} ${quote(name)} ON ${quote(table)}`
        : `${what} ${quote(name)}`;
    }

    /**
     * The line of the `DROP … name` command of an ALTER TABLE. The parser keeps no
     * position for a command, so it is found among the statement's tokens.
     */
    function dropLine(
      statement: SqlStatement,
      fragment: SqlFragment,
      name: string
    ): number | undefined {
      const tokens = tokensFrom(statement, statement.start);
      for (const [index, token] of tokens.entries()) {
        if (token.text.toUpperCase() !== "DROP") continue;
        // DROP [COLUMN | CONSTRAINT] [IF EXISTS] name
        const names = tokens
          .slice(index + 1, index + 5)
          .some((next) => next.text === name || next.text === quote(name));
        if (names) return fragment.lineAt(statement.start + token.start);
      }
      return undefined;
    }

    function scanReplaySafety(file: string, contents: string): Violation[] {
      if (contents.startsWith(GENERATED_AUTHZ_MIGRATION)) return [];
      const steps = migrationSteps(contents);

      const temps = new Set<string>();
      for (const { statement } of steps) {
        const relation =
          "CreateStmt" in statement.node
            ? statement.node.CreateStmt.relation
            : "CreateTableAsStmt" in statement.node
              ? statement.node.CreateTableAsStmt.into?.rel
              : undefined;
        if (relation?.relpersistence === "t") temps.add(relationName(relation));
      }
      const isTemp = (name: string | undefined) =>
        name !== undefined && (temps.has(name) || name.startsWith("pg_temp."));

      const dropped: Dropped[] = [];
      const wiped = new Set<string>();
      /** Triggers and policies are named per table: a DROP that names a table must name this one. */
      const droppedEarlier = (kinds: string[], name: string, table?: string) =>
        dropped.some(
          (drop) =>
            kinds.includes(drop.kind) &&
            drop.name === name &&
            (table === undefined ||
              drop.table === undefined ||
              drop.table === table)
        );

      const violations: Violation[] = [];
      for (const { statement, fragment, trusted } of steps) {
        for (const found of nodesIn(statement.node)) {
          const line =
            found.location === undefined
              ? statement.line
              : fragment.lineAt(found.location);
          // The commands of one ALTER TABLE run in order, so each is taken alone:
          // `DROP CONSTRAINT IF EXISTS x, ADD CONSTRAINT x` is safe.
          for (const node of alterCommands(found.node)) {
            if (!trusted) {
              for (const drop of dropsWithoutIfExists(node)) {
                const kind = DROP_KINDS.get(drop.kind);
                if (!kind || isTemp(drop.name) || isTemp(drop.table)) continue;
                violations.push({
                  file,
                  line:
                    "AlterTableStmt" in node
                      ? (dropLine(statement, fragment, drop.name) ?? line)
                      : line,
                  snippet: `DROP ${kind} ${quote(drop.name)}`,
                  message: `DROP of ${drop.name} has no IF EXISTS: on a re-run after a failed deploy it is already gone and the migration fails again. Write DROP … IF EXISTS.`
                });
              }
              for (const created of createdBy(node)) {
                const { what, name, table, undoneBy, message } = created;
                if (isTemp(name) || isTemp(table)) continue;
                if (droppedEarlier(undoneBy, name, table)) continue;
                // A table dropped earlier is re-created empty, with nothing on it.
                if (table && droppedEarlier(["TABLE"], table)) continue;
                violations.push({
                  file,
                  line:
                    created.location === undefined
                      ? line
                      : fragment.lineAt(created.location),
                  snippet: named(what, name, table),
                  message
                });
              }
              if ("InsertStmt" in node) {
                const table = relationName(node.InsertStmt.relation ?? {});
                const safe =
                  isTemp(table) ||
                  node.InsertStmt.onConflictClause !== undefined ||
                  readsOnlyMissing(statement.node) ||
                  wiped.has(table) ||
                  droppedEarlier(["TABLE"], table);
                if (!safe) {
                  violations.push({
                    file,
                    line,
                    snippet: `INSERT INTO ${quote(table)}`,
                    message: `INSERT INTO ${table} has no ON CONFLICT and no WHERE NOT EXISTS: on a re-run after a failed deploy the rows are already there, and it fails on a unique key or writes them twice.`
                  });
                }
              }
            }
            dropped.push(...droppedBy(node));
            for (const table of wipedBy(node)) wiped.add(table);
          }
        }
      }
      return violations.sort((a, b) => a.line - b.line);
    }

    return (file, contents) => {
      const timestamp = /^(\d{14})_/.exec(file)?.[1];
      if (!timestamp || timestamp <= lastUnchecked) return [];
      return scanReplaySafety(file, contents);
    };
  }
});
