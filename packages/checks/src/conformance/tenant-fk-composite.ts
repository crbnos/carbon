// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ConformanceCheck,
  Provenance,
  SourceFile,
  Violation
} from "../check";
import { blankSqlComments } from "../sources/comments";
import { matchBracket } from "./row-writes";

// A foreign key checks only that the id exists. From a table that carries
// "companyId", `REFERENCES "workCenter"("id")` accepts another company's work
// center, and a service-role write (Kysely, an edge function) skips the RLS
// that would have hidden it. When the parent has a ("id", "companyId") key the
// fix is free: carry the company in the key, so Postgres refuses the row.

/**
 * The newest migration on origin/main when this check landed. Migrations up
 * to here are applied history and cannot be edited; the ones that still hold a
 * single-column tenant FK are left to the fix migrations that follow them
 * (`20260703143904_composite-tenant-fks.sql` and its successors), so there are
 * no baseline entries.
 */
const LAST_UNCHECKED = "20261124175920";

const PART = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
/** A table name with an optional schema: `"item"`, `item`, `public."item"`. */
const NAME = String.raw`${PART}(?:\s*\.\s*${PART})?`;

/**
 * Postgres folds an unquoted identifier to lower case; `public.x` is `x`.
 * Undefined for another schema: only public tables are tenant tables here.
 */
function tableName(raw: string): string | undefined {
  const parts = [...raw.matchAll(new RegExp(PART, "g"))].map(([p]) =>
    p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()
  );
  if (parts.length === 1) return parts[0];
  return parts[0] === "public" ? parts[1] : undefined;
}

const columnName = (raw: string) => {
  const c = raw.trim();
  return c.startsWith('"') ? c.slice(1, -1) : c.toLowerCase();
};

const columnList = (list: string) =>
  list.split(",").map(columnName).filter(Boolean);

/** Exactly ("id", "companyId"), in either order. */
const isTenantKey = (list: string) => {
  const cols = columnList(list);
  return cols.length === 2 && cols.includes("id") && cols.includes("companyId");
};

/** The comma-separated items at the top level of a CREATE TABLE body. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'") {
      const end = body.indexOf(c, i + 1);
      i = end === -1 ? body.length : end;
    } else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      items.push(body.slice(start, i));
      start = i + 1;
    }
  }
  items.push(body.slice(start));
  return items.map((item) => item.trim());
}

const CREATE_TABLE = new RegExp(
  String.raw`\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${NAME})\s*\(`,
  "gi"
);
const ALTER_TABLE = new RegExp(
  String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${NAME})([^;]*)`,
  "gi"
);
/** A non-partial unique index: a partial one cannot be a foreign key target. */
const UNIQUE_INDEX = new RegExp(
  String.raw`\bCREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:${PART}\s+)?ON\s+(?:ONLY\s+)?(${NAME})\s*(?:USING\s+\w+\s*)?\(([^)]*)\)([^;]*)`,
  "gi"
);
const KEY_CONSTRAINT =
  /^(?:CONSTRAINT\s+(?:"[^"]+"|\w+)\s+)?(?:PRIMARY\s+KEY|UNIQUE)\s*\(([^)]*)\)/i;
const ADD_KEY =
  /\bADD\s+(?:CONSTRAINT\s+(?:"[^"]+"|\w+)\s+)?(?:PRIMARY\s+KEY|UNIQUE)\s*\(([^)]*)\)/gi;
const ADD_COMPANY_ID =
  /\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"companyId"|companyid)\s/i;
const RENAME_TABLE = new RegExp(String.raw`^\s*RENAME\s+TO\s+(${PART})`, "i");

export type TenantKeys = {
  /** Tables with a PRIMARY KEY, UNIQUE constraint or unique index on ("id", "companyId"). */
  composite: ReadonlySet<string>;
  /** Tables with a "companyId" column. */
  scoped: ReadonlySet<string>;
};

/**
 * Which tables have a ("id", "companyId") key, and which carry "companyId",
 * read from the migrations in order. Pure: the caller loads the files
 * (`loadSqlFiles(migrationsDir(root))`).
 */
export function tenantKeysFromMigrations(
  migrations: readonly SourceFile[]
): TenantKeys {
  const composite = new Set<string>();
  const scoped = new Set<string>();
  for (const { contents } of migrations) {
    const sql = blankSqlComments(contents);

    for (const m of sql.matchAll(CREATE_TABLE)) {
      const table = tableName(m[1] ?? "");
      if (!table) continue;
      const open = m.index + m[0].length - 1;
      for (const item of topLevelItems(
        sql.slice(open + 1, matchBracket(sql, open))
      )) {
        if (/^(?:"companyId"|companyid)\s/i.test(item)) scoped.add(table);
        const key = KEY_CONSTRAINT.exec(item);
        if (key && isTenantKey(key[1] ?? "")) composite.add(table);
      }
    }

    for (const m of sql.matchAll(ALTER_TABLE)) {
      const table = tableName(m[1] ?? "");
      const rest = m[2] ?? "";
      if (!table) continue;
      const renamed = RENAME_TABLE.exec(rest);
      if (renamed) {
        const to = tableName(renamed[1] ?? "");
        if (to && composite.has(table)) composite.add(to);
        if (to && scoped.has(table)) scoped.add(to);
        continue;
      }
      if (ADD_COMPANY_ID.test(rest)) scoped.add(table);
      for (const key of rest.matchAll(ADD_KEY)) {
        if (isTenantKey(key[1] ?? "")) composite.add(table);
      }
    }

    for (const m of sql.matchAll(UNIQUE_INDEX)) {
      const table = tableName(m[1] ?? "");
      if (table && isTenantKey(m[2] ?? "") && !/\bWHERE\b/i.test(m[3] ?? "")) {
        composite.add(table);
      }
    }
  }
  return { composite, scoped };
}

/** `REFERENCES <table>`, then its optional column list. */
const REFERENCES = new RegExp(
  String.raw`\bREFERENCES\s+(${NAME})\s*(?:\(([^)]*)\))?`,
  "gi"
);
const TABLE_HEADER = new RegExp(
  String.raw`\b(?:CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?)(${NAME})`,
  "gi"
);
const FOREIGN_KEY_COLUMNS = /\bFOREIGN\s+KEY\s*\(\s*([^)]*)\)\s*$/i;
/**
 * The column a `REFERENCES` belongs to: the first word after the `(` `,` or
 * `ADD [COLUMN] [IF NOT EXISTS]` that opens its definition.
 */
const INLINE_COLUMN =
  /(?:[,(]|\bADD(?:\s+COLUMN)?(?:\s+IF\s+NOT\s+EXISTS)?)\s*(?!(?:ADD|COLUMN|IF|CONSTRAINT|FOREIGN|PRIMARY|UNIQUE|CHECK)\b)("[^"]+"|\w+)\s[^,(]*(?:\([^)]*\)[^,(]*)?$/i;

/** The referencing table and column, or undefined when the statement is not one this reads. */
function referencingSide(
  sql: string,
  at: number
): { table: string; columns: string[] } | undefined {
  const statement = sql.slice(sql.lastIndexOf(";", at) + 1, at);
  const header = [...statement.matchAll(TABLE_HEADER)].at(-1);
  const table = header && tableName(header[1] ?? "");
  if (!table || header.index === undefined) return undefined;
  const definition = statement.slice(header.index + header[0].length);
  const fk = FOREIGN_KEY_COLUMNS.exec(definition);
  if (fk) return { table, columns: columnList(fk[1] ?? "") };
  const inline = INLINE_COLUMN.exec(definition);
  return inline ? { table, columns: [columnName(inline[1] ?? "")] } : undefined;
}

export const provenance: Provenance = {
  deprecates:
    'a single-column FK from a "companyId" table to a tenant table: REFERENCES "workCenter"("id")',
  replacedBy:
    'FOREIGN KEY ("workCenterId", "companyId") REFERENCES "workCenter"("id", "companyId")',
  since: "20260703143904_composite-tenant-fks.sql",
  incidents: ["3fc6be2f2d", "8a5281c6ff", "aa781984a4", "ba1db4283e"]
};

/**
 * Fails a new foreign key from a table with "companyId" to a table with a
 * ("id", "companyId") key that names the id alone. `keys` comes from
 * `tenantKeysFromMigrations`; the scanned file's own tables are added to it, so
 * a table created in the same migration counts.
 */
export function tenantFkComposite(keys: TenantKeys): ConformanceCheck {
  return {
    id: "tenant-fk-composite",
    description:
      'A foreign key from a company-scoped table to a table keyed ("id", "companyId") must carry "companyId".',
    provenance,
    triggers: ["REFERENCES"],
    scan(file, contents) {
      const base = file.split("/").pop() ?? file;
      if (base <= LAST_UNCHECKED) return [];

      const own = tenantKeysFromMigrations([{ file, contents }]);
      const composite = (t: string) =>
        keys.composite.has(t) || own.composite.has(t);
      const scoped = (t: string) => keys.scoped.has(t) || own.scoped.has(t);

      const sql = blankSqlComments(contents);
      const violations: Violation[] = [];
      for (const m of sql.matchAll(REFERENCES)) {
        const target = tableName(m[1] ?? "");
        if (!target || !composite(target) || !scoped(target)) continue;
        const referenced = columnList(m[2] ?? "");
        if (referenced.length > 1) continue;
        if (referenced.length === 1 && referenced[0] !== "id") continue;

        const side = referencingSide(sql, m.index);
        if (!side || !scoped(side.table)) continue;
        if (side.columns.includes("companyId")) continue;

        const column = side.columns[0] ?? "<column>";
        const at = m.index;
        violations.push({
          file,
          line: sql.slice(0, at).split("\n").length,
          snippet: sql
            .slice(sql.lastIndexOf("\n", at) + 1, at + m[0].length)
            .trim()
            .replace(/\s+/g, " "),
          message: `${side.table}.${column} references "${target}" by id alone, so a row of one company can point at another company's ${target}. "${target}" has a ("id", "companyId") key: write FOREIGN KEY ("${column}", "companyId") REFERENCES "${target}"("id", "companyId"), with ON DELETE SET NULL ("${column}") on a nullable column so "companyId" survives.`
        });
      }
      return violations;
    }
  };
}
