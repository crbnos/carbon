// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Textual extractor over the GENERATED @carbon/database types
// (packages/database/src/types.ts), so the tool-metadata generator can resolve
// `Database["public"]["Enums"]["x"]` and
// `Database["public"]["Tables"]["t"]["Row"|"Insert"|"Update"]` references into
// real schemas instead of publishing `{}`. Read-only over generated output —
// never a reason to hand-edit that file.

import * as fs from "fs";
import * as path from "path";

const TYPES_FILE = path.resolve(
  __dirname,
  "../../packages/database/src/types.ts"
);
// The generated `Constants` block (enum values) lives in its own file.
const CONSTANTS_FILE = path.resolve(
  __dirname,
  "../../packages/database/src/constants.ts"
);

let cachedContent: string | null | undefined;

function typesContent(): string | null {
  if (cachedContent === undefined) {
    cachedContent = fs.existsSync(TYPES_FILE)
      ? fs.readFileSync(TYPES_FILE, "utf-8") +
        (fs.existsSync(CONSTANTS_FILE)
          ? `\n${fs.readFileSync(CONSTANTS_FILE, "utf-8")}`
          : "")
      : null;
  }
  return cachedContent;
}

/** Test seam: inject content instead of reading the generated file. */
export function __setDbTypesContentForTest(content: string | null): void {
  cachedContent = content;
}

/**
 * Enum values from the generated `Constants.public.Enums` section —
 * `warehouseTransferStatus: ["Draft", "To Ship", …]`. Null when the enum (or
 * the generated file) is missing; the caller degrades to a bare string.
 */
export function getDbEnumValues(name: string): string[] | null {
  const content = typesContent();
  if (!content) return null;
  const constantsStart = content.indexOf("export const Constants");
  if (constantsStart < 0) return null;
  const entry = new RegExp(`\\b${name}: \\[`).exec(
    content.slice(constantsStart)
  );
  if (!entry) return null;
  const from = constantsStart + entry.index + entry[0].length;
  const to = content.indexOf("]", from);
  if (to < 0) return null;
  const values = [...content.slice(from, to).matchAll(/"([^"]*)"/g)].map(
    (m) => m[1]!
  );
  return values.length > 0 ? values : null;
}

export type DbTableField = {
  name: string;
  optional: boolean;
  typeStr: string;
};

/**
 * The field list of one generated table type (`Row` / `Insert` / `Update`).
 * Fields are one-per-line in the generated file; a wrapped union continues on
 * lines starting with `|` and is folded back onto its field. Null when the
 * table or the generated file is missing.
 */
export function getDbTableTypeFields(
  table: string,
  op: "Row" | "Insert" | "Update"
): DbTableField[] | null {
  const content = typesContent();
  if (!content) return null;

  const tablesStart = content.indexOf("    Tables: {");
  if (tablesStart < 0) return null;
  const tableMatch = new RegExp(`\\n      ${table}: \\{`).exec(
    content.slice(tablesStart)
  );
  if (!tableMatch) return null;
  const tableStart = tablesStart + tableMatch.index;

  const opMatch = new RegExp(`\\n        ${op}: \\{`).exec(
    content.slice(tableStart)
  );
  if (!opMatch) return null;

  // Brace-matched extraction of the op block's body.
  const bodyStart = tableStart + opMatch.index + opMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  for (; i < content.length && depth > 0; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
  }
  const body = content.slice(bodyStart, i - 1);

  const fields: DbTableField[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = line.match(/^(\w+)(\?)?:\s*(.+)$/);
    if (head) {
      fields.push({
        name: head[1]!,
        optional: head[2] === "?",
        typeStr: head[3]!.trim()
      });
    } else if (line.startsWith("|") && fields.length > 0) {
      // A union member wrapped onto its own line belongs to the last field.
      fields[fields.length - 1]!.typeStr += ` ${line}`;
    }
  }
  return fields.length > 0 ? fields : null;
}

/**
 * The tables of the generated types that have `column`. Tables only: a view is
 * not written through. Empty when the generated file is missing.
 */
export function getDbTablesWithColumn(column: string): string[] {
  return [...getDbRelationNames("Tables")]
    .filter((table) =>
      getDbTableTypeFields(table, "Row")?.some((field) => field.name === column)
    )
    .sort();
}

/** The `public` schema's section of the generated types, `Tables` or `Views`. */
function publicSection(kind: "Tables" | "Views"): string {
  const content = typesContent();
  if (!content) return "";
  const schema = content.indexOf("\n  public: {");
  if (schema < 0) return "";
  const tables = content.indexOf("    Tables: {", schema);
  const views = content.indexOf("\n    Views: {", tables);
  const functions = content.indexOf("\n    Functions: {", views);
  if (tables < 0 || views < 0) return "";
  return kind === "Tables"
    ? content.slice(tables, views)
    : content.slice(views, functions < 0 ? undefined : functions);
}

/** The names of the `public` tables, or views, in the generated types. */
export function getDbRelationNames(kind: "Tables" | "Views"): Set<string> {
  return new Set(
    [...publicSection(kind).matchAll(/\n {6}(\w+): \{/g)].map((m) => m[1]!)
  );
}

/**
 * Each table's single-column foreign keys to another TABLE's `id`:
 * table → column → referenced tables. The generated types repeat a foreign key
 * once per view that exposes the referenced id (`employees`, `employeeSummary`);
 * only the table counts.
 */
export function getDbForeignKeys(): Map<string, Map<string, Set<string>>> {
  const section = publicSection("Tables");
  const tables = getDbRelationNames("Tables");
  const out = new Map<string, Map<string, Set<string>>>();
  for (const block of section.split(/\n {6}(?=\w+: \{)/)) {
    const table = block.match(/^(\w+): \{/)?.[1];
    if (!table) continue;
    for (const m of block.matchAll(
      /columns: \["(\w+)"\]\s+isOneToOne: \w+\s+referencedRelation: "(\w+)"\s+referencedColumns: \["id"\]/g
    )) {
      const [, column, referenced] = m;
      if (!tables.has(referenced!)) continue;
      const columns = out.get(table) ?? new Map<string, Set<string>>();
      out.set(table, columns);
      const targets = columns.get(column!) ?? new Set<string>();
      columns.set(column!, targets);
      targets.add(referenced!);
    }
  }
  return out;
}
