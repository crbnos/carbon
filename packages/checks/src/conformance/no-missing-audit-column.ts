import type { ConformanceCheck, Violation } from "../check";

/**
 * A write must not name `createdBy` / `updatedBy` on a table that has no such
 * column. PostgREST rejects the whole statement with
 * `PGRST204 Could not find the 'createdBy' column of '<table>' in the schema
 * cache`, and TypeScript does not catch it — supabase-js widens the
 * insert/upsert argument enough that the excess property survives, which is how
 * `sales-rfq.$rfqId.map-lines.ts` shipped an upsert on `customerPartToItem`
 * (six columns, none of them audit) whose result was never checked, so every
 * RFQ-line → customer-part mapping silently failed.
 *
 * Roughly a third of Carbon's tables have no audit columns — favourites, link
 * tables, the lean material lookups, `companySettings` — while the convention
 * (`conventions-index.md` golden rule 3) says to include them, so this is an
 * easy assumption to carry into the wrong table.
 *
 * Scope is the LITERAL argument of the write. A payload object spread into the
 * row (`insert([row])`) can carry the same bad key, but only the caller knows
 * what is in it; for the MCP/API layer that decision is derived from this same
 * generated schema by `withoutAbsentAuditColumns` in
 * `scripts/lib/service-metadata.ts`.
 */
const AUDIT_FIELDS = ["createdBy", "updatedBy"] as const;

/** `.from("t")`, `insertInto("t")`, `updateTable("t")`. */
const TARGET_RE = /(?:\.from|insertInto|updateTable)\(\s*["'`](\w+)["'`]\s*\)/g;
/** The write whose argument we inspect, if it follows closely enough. */
const WRITE_RE = /\.\s*(?:insert|upsert|update|values|set)\s*\(/;
/** How far past the table name the write call may start (allows a line break). */
const WRITE_WINDOW = 160;

function balanced(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

export function noMissingAuditColumn(
  columns: Map<string, Set<string>>
): ConformanceCheck {
  return {
    id: "no-missing-audit-column",
    description:
      "A write never names createdBy/updatedBy on a table that has no such column — PostgREST rejects the statement with PGRST204 and TypeScript does not catch it.",
    provenance: {
      deprecates:
        "stamping createdBy/updatedBy on a table without audit columns (the customerPartToItem upsert in sales-rfq.$rfqId.map-lines.ts, which failed every call)",
      replacedBy:
        "writing only the columns the table has; the MCP/API layer derives the same answer from the generated types in scripts/lib/service-metadata.ts",
      since: "PGRST204 on items_upsertItemCustomerPart"
    },
    scan(file, contents) {
      const violations: Violation[] = [];
      TARGET_RE.lastIndex = 0;
      for (const target of contents.matchAll(TARGET_RE)) {
        const table = target[1];
        const present = table ? columns.get(table) : undefined;
        if (!present) continue;
        const missing = AUDIT_FIELDS.filter((f) => !present.has(f));
        if (missing.length === 0) continue;

        const after = target.index + target[0].length;
        const write = WRITE_RE.exec(
          contents.slice(after, after + WRITE_WINDOW)
        );
        if (!write) continue;

        const open = after + write.index + write[0].length - 1;
        const arg = contents.slice(open, balanced(contents, open) + 1);
        for (const field of missing) {
          const key = new RegExp(`(^|[{,\\s])${field}\\s*[,:}]`).exec(arg);
          if (!key) continue;
          violations.push({
            file,
            line: contents.slice(0, open + key.index).split("\n").length,
            snippet: field,
            message: `"${table}" has no "${field}" column — this write fails with PGRST204 (and TypeScript will not flag it). Remove the field.`
          });
        }
      }
      return violations;
    }
  };
}
