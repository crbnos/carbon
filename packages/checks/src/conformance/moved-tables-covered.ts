// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  moduleEnum,
  moduleOf,
  ownersOf,
  PAGES,
  type Page
} from "@carbon/database/access";
import type { SourceFile, Violation } from "../check";

export const MOVED_TABLES_COVERED = "moved-tables-covered";

/** The migration whose `moved` rows turn an old module grant into a page grant. */
export const MOVED_TABLES_MIGRATION =
  "packages/database/supabase/migrations/20261110101723_grants-for-moved-tables.sql";

/** The registry facts the check needs; `REGISTRY` is the real one. */
export type MovedTablesRegistry = {
  pages: readonly {
    id: string;
    maxLevel: string;
    alsoWrittenBy?: Readonly<Record<string, readonly string[]>>;
  }[];
  /** The table's page, or every branch's page for a shared table or a child; empty when no page lists it. */
  ownersOf(table: string): string[];
  /** The `module` enum label of the page's module: `inventory.receipts` → `Inventory`. */
  moduleEnumOf(page: string): string;
};

export const REGISTRY: MovedTablesRegistry = {
  pages: PAGES as readonly Page[],
  ownersOf,
  moduleEnumOf: (page) => moduleEnum(moduleOf(page) as never)
};

type MovedRow = {
  newModule: string;
  page: string;
  cap: string;
  /** The registry tables the row's trailing comment names. */
  tables: string[];
  line: number;
};

/**
 * The `moved` rows: `('Old', 'New', 'module.page', 'Cap'), -- table, table…`.
 * The rows sit between `VALUES` and the `typed` CTE.
 */
function movedRows(sql: string, registry: MovedTablesRegistry): MovedRow[] {
  const start = sql.indexOf("VALUES");
  const end = sql.indexOf("),\ntyped");
  if (start === -1) return [];
  const values = sql.slice(start, end === -1 ? undefined : end);
  return [
    ...values.matchAll(
      /\('(\w+)', '(\w+)', '([\w.]+)', '(\w+)'\),?\s*--([^\n]*)/g
    )
  ].map((m) => ({
    newModule: m[2] as string,
    page: m[3] as string,
    cap: m[4] as string,
    tables: [
      ...(m[5] as string).matchAll(/\b[a-z]\w*[A-Z]\w*\b|\b[a-z]{4,}\b/g)
    ]
      .map((word) => word[0])
      .filter((word) => registry.ownersOf(word).length > 0),
    line: sql.slice(0, start + (m.index ?? 0)).split("\n").length
  }));
}

/**
 * A table whose owning page is in another module than its policy checked before
 * keeps its old writers one way only: a page grant on its new page (a `moved`
 * row of the migration), or the old page listed in the new page's
 * `alsoWrittenBy`. Both, and a role holds the new page twice over; neither, and
 * it loses the table.
 *
 * It fails:
 * - a migration with no `moved` rows (the parse broke);
 * - a row whose page is not in the registry, whose new module is not that
 *   page's module, or whose cap is not that page's `maxLevel`;
 * - a table the row names covered by both, or by neither;
 * - an `alsoWrittenBy` table whose owning page also gets a grant.
 */
export function findMovedTableGaps(
  migration: SourceFile,
  registry: MovedTablesRegistry = REGISTRY
): Violation[] {
  const { file } = migration;
  const rows = movedRows(migration.contents, registry);
  const violations: Violation[] = [];
  const push = (line: number, snippet: string, message: string) =>
    violations.push({ file, line, snippet, message });

  if (rows.length === 0) {
    push(
      0,
      "moved",
      "no `moved` rows found: the VALUES list or the `typed` CTE changed shape"
    );
    return violations;
  }

  const alsoWritten = registry.pages.flatMap((page) =>
    Object.keys(page.alsoWrittenBy ?? {}).map((table) => ({
      page: page.id,
      table
    }))
  );
  const byId = new Map(registry.pages.map((page) => [page.id, page]));

  for (const row of rows) {
    const page = byId.get(row.page);
    if (!page) {
      push(row.line, row.page, `${row.page} is not a page in the registry`);
      continue;
    }
    const module = registry.moduleEnumOf(row.page);
    if (module !== row.newModule)
      push(
        row.line,
        row.newModule,
        `${row.page} is in module ${module}, not ${row.newModule}`
      );
    if (row.cap !== page.maxLevel)
      push(
        row.line,
        row.cap,
        `${row.page}: cap ${row.cap} is not the page's maxLevel ${page.maxLevel}`
      );
    for (const table of row.tables) {
      const byGrant = registry.ownersOf(table).includes(row.page);
      const byWriters = alsoWritten.some((entry) => entry.table === table);
      if (byGrant === byWriters)
        push(
          row.line,
          table,
          byGrant
            ? `${table} (${row.page}) is covered twice: by this grant and by alsoWrittenBy`
            : `${table} (${row.page}) is covered by neither a grant on a page that owns it nor alsoWrittenBy`
        );
    }
  }

  const granted = new Set(rows.map((row) => row.page));
  for (const entry of alsoWritten)
    for (const owner of registry.ownersOf(entry.table))
      if (granted.has(owner))
        push(
          0,
          entry.table,
          `${entry.table} is in ${entry.page}'s alsoWrittenBy, and ${owner} gets a grant in this migration`
        );

  return violations;
}
