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

let cachedContent: string | null | undefined;

function typesContent(): string | null {
  if (cachedContent === undefined) {
    cachedContent = fs.existsSync(TYPES_FILE)
      ? fs.readFileSync(TYPES_FILE, "utf-8")
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
    (m) => m[1]
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
        name: head[1],
        optional: head[2] === "?",
        typeStr: head[3].trim()
      });
    } else if (line.startsWith("|") && fields.length > 0) {
      // A union member wrapped onto its own line belongs to the last field.
      fields[fields.length - 1].typeStr += ` ${line}`;
    }
  }
  return fields.length > 0 ? fields : null;
}
