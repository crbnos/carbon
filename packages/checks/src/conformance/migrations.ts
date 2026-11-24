// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Node, RangeVar } from "libpg-query";
import {
  type Check,
  fileCheck,
  type SourceFile,
  type Violation
} from "../check";
import { migrations } from "../sources/inputs";
import {
  ancestorsOf,
  nameParts,
  nodesIn,
  relationName,
  type SqlBody,
  type SqlFragment,
  type SqlStatement,
  sqlFragments,
  sqlNodes,
  tokensFrom,
  typeNamesIn
} from "../sources/sql";
import { GENERATED_AUTHZ_MIGRATION } from "./authz";

/*
 * What a migration may write. Columns keep entered facts and safe defaults,
 * foreign keys and views state how they behave, a redefined function keeps
 * the changes before it, and every statement survives a re-run over a failed
 * deploy.
 */

// --- no-numeric-precision ---

/** The integer a type modifier holds: the `10` of `NUMERIC(10,2)`. */
function integerOf(modifier: Node): number | undefined {
  return "A_Const" in modifier ? modifier.A_Const.ival?.ival : undefined;
}

export const noNumericPrecision = fileCheck(migrations, {
  id: "no-numeric-precision",
  description: "Use bare NUMERIC, not NUMERIC(x,y).",
  provenance: {
    deprecates: "NUMERIC(x,y)",
    replacedBy: "NUMERIC"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const fragment of sqlFragments(contents)) {
      for (const { names, typmods, location } of typeNamesIn(
        fragment.statements.map((statement) => statement.node)
      )) {
        // NUMERIC and DECIMAL are one type; a precision alone (`NUMERIC(10)`)
        // is an integer bound, not the fixed scale this check retires.
        if (nameParts(names).at(-1) !== "numeric" || typmods?.length !== 2) {
          continue;
        }
        const [precision, scale] = typmods.map(integerOf);
        violations.push({
          file,
          line: fragment.lineAt(location),
          snippet: `NUMERIC(${precision},${scale})`,
          message: "NUMERIC(x,y) is deprecated; use bare NUMERIC."
        });
      }
    }
    return violations;
  }
});

// --- no-derived-percent-column ---

// A generated `*Percent`/`*Rate` column whose expression DIVIDES is a lossy
// echo of a rounded amount, not a stored fact — the purchasing taxPercent bug:
// rate = amount / subtotal turned a typed 6.25% into 6.22% after the amount
// was rounded to cents. Percentages are entered facts; amounts derive from
// them (applyRate), never the reverse.

function divides(expression: Node | undefined): boolean {
  for (const { node } of nodesIn(expression)) {
    if ("A_Expr" in node && nameParts(node.A_Expr.name).includes("/")) {
      return true;
    }
  }
  return false;
}

export const noDerivedPercentColumn = fileCheck(migrations, {
  id: "no-derived-percent-column",
  description:
    "Percent/rate columns must be plain stored values, never GENERATED expressions that divide",
  provenance: {
    deprecates:
      "generated percent columns derived by division (rate = amount / subtotal)",
    replacedBy:
      "writable percent columns; amounts derive via applyRate in @carbon/utils",
    since: "2026-08-11"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if (!("ColumnDef" in node)) continue;
      const { colname = "", constraints, location } = node.ColumnDef;
      const name = colname.toLowerCase();
      if (!name.endsWith("percent") && !name.endsWith("rate")) continue;
      const derived = (constraints ?? []).some(
        (constraint) =>
          "Constraint" in constraint &&
          constraint.Constraint.contype === "CONSTR_GENERATED" &&
          divides(constraint.Constraint.raw_expr)
      );
      if (!derived) continue;
      violations.push({
        file,
        line: fragment.lineAt(location),
        snippet: `"${colname}" GENERATED`,
        message:
          "Generated percent/rate column derives by division — store the entered rate and derive the amount via applyRate (@carbon/utils; see .claude/rules/numeric-precision.md)"
      });
    }
    return violations;
  }
});

// --- no-required-column-without-default ---

// Only `ALTER TABLE … ADD COLUMN` is checked. A `NOT NULL` column in a
// `CREATE TABLE` is not a backup-compatibility problem: the table is simply
// absent from older manifests, which `reportBackupCompatibility` already
// handles as a separate finding.
//
// A column with a value of its own passes: a DEFAULT, a GENERATED expression
// or an identity (a backup can never supply those, and
// `reportBackupCompatibility` excludes them for the same reason), and a serial
// type, whose default is its sequence.
const SUPPLIES_A_VALUE = new Set([
  "CONSTR_DEFAULT",
  "CONSTR_GENERATED",
  "CONSTR_IDENTITY"
]);
const SERIAL_TYPES = new Set(["smallserial", "serial", "bigserial"]);

export const noRequiredColumnWithoutDefault = fileCheck(migrations, {
  id: "no-required-column-without-default",
  description:
    "A new NOT NULL column must ship a DEFAULT, so existing backups stay restorable.",
  provenance: {
    deprecates: 'ADD COLUMN "x" TEXT NOT NULL',
    replacedBy: "ADD COLUMN \"x\" TEXT NOT NULL DEFAULT ''"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if (!("AlterTableStmt" in node)) continue;
      const { relation, cmds } = node.AlterTableStmt;
      for (const cmd of cmds ?? []) {
        if (!("AlterTableCmd" in cmd)) continue;
        const { subtype, def } = cmd.AlterTableCmd;
        if (subtype !== "AT_AddColumn" || !def || !("ColumnDef" in def)) {
          continue;
        }
        const { colname, constraints, typeName, location } = def.ColumnDef;
        const kinds = (constraints ?? []).flatMap((constraint) =>
          "Constraint" in constraint ? [constraint.Constraint.contype] : []
        );
        if (!kinds.includes("CONSTR_NOTNULL")) continue;
        if (kinds.some((kind) => kind && SUPPLIES_A_VALUE.has(kind))) continue;
        if (SERIAL_TYPES.has(nameParts(typeName?.names).at(-1) ?? "")) continue;
        violations.push({
          file,
          line: fragment.lineAt(location),
          snippet: `ADD COLUMN "${relationName(relation ?? {})}"."${colname}" NOT NULL`,
          message:
            "A NOT NULL column with no DEFAULT makes every existing backup unrestorable — the backup has no value to supply for it, so the compatibility gate refuses the whole restore. Add a DEFAULT, or make the column nullable and backfill."
        });
      }
    }
    return violations;
  }
});

// --- no-foreign-key-without-on-delete ---

/**
 * Migrations are history, so the check applies only to migrations newer than
 * the newest one that existed when it landed. Every older reference is
 * grandfathered by position rather than by a baseline list.
 */
const CUTOFF = "20261120052902";

/**
 * Whether the reference that starts at `location` writes `ON DELETE`. The
 * parse tree cannot say: it holds NO ACTION for a missing clause and for a
 * written `ON DELETE NO ACTION` alike. The clause, if any, sits before the
 * `,` or `)` that ends the constraint.
 */
function writesOnDelete(statement: SqlStatement, location: number): boolean {
  let depth = 0;
  let previous = "";
  for (const token of tokensFrom(statement, location)) {
    const word = token.text.toUpperCase();
    if (word === "(") depth++;
    if (word === ")") depth--;
    if (depth < 0 || (depth === 0 && (word === "," || word === ";"))) break;
    if (previous === "ON" && word === "DELETE") return true;
    previous = word;
  }
  return false;
}

export const noForeignKeyWithoutOnDelete = fileCheck(migrations, {
  id: "no-foreign-key-without-on-delete",
  description:
    "A foreign key must state ON DELETE. The default (NO ACTION) is a decision nobody made.",
  provenance: {
    deprecates: "REFERENCES t(id) with no ON DELETE clause",
    replacedBy: "REFERENCES t(id) ON DELETE CASCADE | SET NULL | RESTRICT"
  },
  scan(file, contents) {
    const base = file.split("/").pop() ?? file;
    if (base <= CUTOFF) return [];

    const violations: Violation[] = [];
    for (const { node, fragment, statement } of sqlNodes(contents)) {
      if (!("Constraint" in node)) continue;
      const { contype, pktable, fk_del_action } = node.Constraint;
      if (contype !== "CONSTR_FOREIGN" || !pktable) continue;
      // Any action but NO ACTION can only have been written.
      if (fk_del_action !== "a") continue;
      if (writesOnDelete(statement, pktable.location ?? 0)) continue;
      violations.push({
        file,
        line: fragment.lineAt(pktable.location),
        snippet: `REFERENCES "${relationName(pktable)}"`,
        message:
          "State ON DELETE on this foreign key: CASCADE for regenerable children, SET NULL for optional links, RESTRICT to keep the parent. The default is a silent choice."
      });
    }
    return violations;
  }
});

// --- no-view-without-invoker ---

// Every view in "public" is a PostgREST endpoint reachable with the anon key the
// apps publish. Without `security_invoker` a view runs as its owner and the RLS
// on the tables underneath never sees the caller: `openJobMaterialLines`
// served every company's rows to anyone for months, after four migrations
// recreated it from a copy that lacked the clause.
//
// Any `security_invoker` option passes, `security_invoker = false` included:
// the rule is that a view states how it runs, so an owner-rights view is a
// visible decision rather than an omission. A materialized view is not a
// `CREATE VIEW` statement and cannot run as its caller at all (it must have
// SELECT revoked from anon and authenticated instead).
//
// `CREATE OR REPLACE VIEW` replaces the view's options too, so a redefinition
// that leaves out the clause turns an invoker view back into an owner-rights
// view. Every redefinition must state it again.
//
// The check reads the parsed statements, so it sees a view created in a DO
// block or in an `EXECUTE` of a plain string. A view built by
// `EXECUTE format(...)` still escapes it. The invariant
// `src/invariants/view-without-security-invoker.sql` is the backstop: it reads
// the live catalog, whatever created the view.

function namesInvoker(options: Node[] | undefined): boolean {
  return (options ?? []).some(
    (option) =>
      "DefElem" in option && option.DefElem.defname === "security_invoker"
  );
}

function quoted(view: RangeVar | undefined): string {
  return [view?.schemaname, view?.relname]
    .filter((part) => part !== undefined)
    .map((part) => `"${part}"`)
    .join(".");
}

export const noViewWithoutInvoker = fileCheck(migrations, {
  id: "no-view-without-invoker",
  description:
    "A view must state security_invoker, or it runs as its owner and bypasses RLS.",
  provenance: {
    deprecates: 'CREATE OR REPLACE VIEW "x" AS',
    replacedBy: 'CREATE OR REPLACE VIEW "x" WITH (security_invoker = true) AS',
    since: "20260926093417_open-job-material-lines-invoker.sql"
  },
  scan(file, contents) {
    const violations: Violation[] = [];
    for (const { node, fragment } of sqlNodes(contents)) {
      if ("ViewStmt" in node) {
        const { view, options } = node.ViewStmt;
        if (namesInvoker(options)) continue;
        violations.push({
          file,
          line: fragment.lineAt(view?.location),
          snippet: `CREATE VIEW ${quoted(view)}`,
          message: `View ${quoted(view)} has no security_invoker, so it runs as its owner: the RLS on the tables underneath never applies, and PostgREST serves every company's rows to anyone holding the anon key. Add WITH (security_invoker = true).`
        });
      }
      // `ALTER VIEW … RESET (security_invoker)` puts a view back on the
      // owner-rights default as silently as recreating it without the clause.
      if (
        "AlterTableStmt" in node &&
        node.AlterTableStmt.objtype === "OBJECT_VIEW"
      ) {
        const { relation, cmds } = node.AlterTableStmt;
        for (const cmd of cmds ?? []) {
          if (!("AlterTableCmd" in cmd)) continue;
          const { subtype, def } = cmd.AlterTableCmd;
          if (subtype !== "AT_ResetRelOptions" || !def || !("List" in def)) {
            continue;
          }
          if (!namesInvoker(def.List.items)) continue;
          violations.push({
            file,
            line: fragment.lineAt(relation?.location),
            snippet: `ALTER VIEW ${quoted(relation)} RESET (security_invoker)`,
            message: `RESET (security_invoker) puts view ${quoted(relation)} back on owner rights, bypassing RLS for every PostgREST caller. Use SET (security_invoker = true), or state security_invoker = false if owner rights are intended.`
          });
        }
      }
    }
    return violations;
  }
});

// --- function-redefinition-keeps-changes ---

export const FUNCTION_REDEFINITION_KEEPS_CHANGES =
  "function-redefinition-keeps-changes";

/** Migrations before this one are history; only a new redefinition is checked. */
export const CHECKED_SINCE = "20261016000000";

/** Fewer dropped lines than this is a deliberate edit, not a lost change. */
const MIN_DROPPED = 2;

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
export function findDroppedFunctionChanges(
  migrations: SourceFile[]
): Violation[] {
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
      const current = list[k]!;
      if (current.file < CHECKED_SINCE) continue;
      const previous = list[k - 1]!;
      const older = list[k - 2]!;
      const dropped = [...previous.lines].filter(
        (line) => !older.lines.has(line) && !current.lines.has(line)
      );
      if (dropped.length < MIN_DROPPED) continue;
      out.push({
        file: current.file,
        line: 0,
        snippet: `${current.name} drops ${previous.file}`,
        message: `${current.file} redefines ${signature} without ${dropped.length} lines that ${previous.file} added (e.g. "${dropped[0]}"). Start the CREATE OR REPLACE from the newest definition. If the change is removed on purpose, say so in the migration header and baseline this finding.`
      });
    }
  }
  return out;
}

/** The parser's internal type names, as Postgres prints them in a signature. */
const PRINTED_TYPES: Record<string, string> = {
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
      (PRINTED_TYPES[name] ?? name) +
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

export const functionRedefinitionKeepsChanges: Check = {
  id: FUNCTION_REDEFINITION_KEEPS_CHANGES,
  description:
    "A migration that redefines a function must start from its newest definition.",
  find: (repo) => findDroppedFunctionChanges(repo.read(migrations))
};

// --- migration-replay-safe ---

// The deploy runner re-runs a failed migration over what it already committed
// (a migration may `COMMIT` part way), so a statement that errors on an object
// already there, or already gone, fails every later deploy (`cb75027fc2`).
//
// The runner is `ci/src/migrations.ts` (`supabase db push --include-all`). A
// migration may commit part way, for example after `ALTER TYPE … ADD VALUE`.
// An unguarded statement then fails every deploy until someone edits the
// applied file (`cb75027fc2`, `25243520b4`, `11a7a60999`, `f47e4a25bf`).
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

/**
 * Migrations up to here are applied history and cannot be edited. This was
 * the newest migration when the rule was written. After the 2026-06
 * idempotency pass (`c64c3be9a5`), many older migrations still broke the
 * rule, and a sample of them had no false positives. Applied history cannot
 * change, so they are not checked and have no baseline entries.
 */
const LAST_UNCHECKED = "20261119125737";

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
      if (subtype === "AT_DropColumn") return [{ kind: "COLUMN", name, table }];
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

/** The DROP kinds this check asks IF EXISTS of. */
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
    if (!("AlterTableCmd" in cmd) || cmd.AlterTableCmd.missing_ok) return [];
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
    if (fragment.inside.some((body) => !("DoStmt" in body.statement))) continue;
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

/** An ALTER TABLE as one statement per command; any other node as itself. */
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

export function scanReplaySafety(file: string, contents: string): Violation[] {
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

export const migrationReplaySafe = fileCheck(migrations, {
  id: "migration-replay-safe",
  description:
    "Every migration statement must succeed when the migration is re-run over a failed deploy's partial state.",
  provenance: {
    deprecates: 'CREATE TABLE "x" / ADD COLUMN "y" / DROP CONSTRAINT "z"',
    replacedBy:
      'CREATE TABLE IF NOT EXISTS "x" / ADD COLUMN IF NOT EXISTS "y" / DROP CONSTRAINT IF EXISTS "z"',
    since: `after ${LAST_UNCHECKED}_job-wip-balance.sql`,
    incidents: ["f47e4a25bf", "cb75027fc2"]
  },
  scan(file, contents) {
    const timestamp = /^(\d{14})_/.exec(file)?.[1];
    if (!timestamp || timestamp <= LAST_UNCHECKED) return [];
    return scanReplaySafety(file, contents);
  }
});

/** The migrations checks, in the order they are written above. */
export const checks: Check[] = [
  noNumericPrecision,
  noDerivedPercentColumn,
  noRequiredColumnWithoutDefault,
  noForeignKeyWithoutOnDelete,
  noViewWithoutInvoker,
  functionRedefinitionKeepsChanges,
  migrationReplaySafe
];
