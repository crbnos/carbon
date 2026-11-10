// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  moduleEnum,
  moduleOf,
  PAGES,
  type Page,
  placeOf
} from "../access/registry";
import { MIGRATIONS_DIR } from "./migration";
import { registryHelperFiles } from "./registry-sql";

describe("helpers rendered from the registry", () => {
  test.each(registryHelperFiles())(
    "$file matches the registry",
    ({ file, sql }) => {
      expect(
        readFileSync(file, "utf8"),
        `${path.basename(file)} is stale: run pnpm --filter @carbon/database authz sync`
      ).toBe(sql);
    }
  );
});

/** Each table's page, or every branch's page for a shared table or a child. */
const ownersOf = (table: string): string[] => {
  const place = placeOf(table);
  if (!place) return [];
  return place.kind === "page"
    ? [place.page]
    : place.branches.map((branch) => branch.page);
};

const ALSO_WRITTEN = (PAGES as readonly Page[]).flatMap((page) =>
  Object.entries(page.alsoWrittenBy ?? {}).map(([table, writers]) => ({
    page: page.id,
    table,
    writers
  }))
);

/**
 * The rows of 20261110101723_grants-for-moved-tables.sql: the page each moved
 * table's old module grant becomes a grant on, and the tables its comment names.
 */
const MOVED = (() => {
  const sql = readFileSync(
    path.join(MIGRATIONS_DIR, "20261110101723_grants-for-moved-tables.sql"),
    "utf8"
  );
  const values = sql.slice(sql.indexOf("VALUES"), sql.indexOf("),\ntyped"));
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
      .filter((word) => placeOf(word))
  }));
})();

describe("tables that moved to another module's page", () => {
  test("the migration's rows name real pages, each at its maxLevel", () => {
    expect(MOVED.length).toBeGreaterThan(0);
    for (const row of MOVED) {
      const page = (PAGES as readonly Page[]).find((p) => p.id === row.page);
      expect(page, row.page).toBeDefined();
      expect(moduleEnum(moduleOf(row.page) as never)).toBe(row.newModule);
      expect(row.cap).toBe(page?.maxLevel);
    }
  });

  // A moved table keeps its old writers one way: a grant on its new page (the
  // migration), or the old page listed in alsoWrittenBy. Both, and a role holds
  // the new page twice over; neither, and it loses the table.
  test("each moved table is covered once: by a page grant in the migration, or by alsoWrittenBy", () => {
    const problems: string[] = [];
    const granted = new Set(MOVED.map((row) => row.page));
    for (const row of MOVED) {
      for (const table of row.tables) {
        const byGrant = ownersOf(table).includes(row.page);
        const byWriters = ALSO_WRITTEN.some((entry) => entry.table === table);
        if (byGrant === byWriters)
          problems.push(
            `${table} (${row.page}): ${byGrant ? "both" : "neither"}`
          );
      }
    }
    for (const entry of ALSO_WRITTEN)
      for (const owner of ownersOf(entry.table))
        if (granted.has(owner))
          problems.push(
            `${entry.table}: alsoWrittenBy, and ${owner} gets a grant`
          );
    expect(problems).toEqual([]);
  });

  test("alsoWrittenBy lists tables the page owns and pages that exist", () => {
    const ids = new Set<string>((PAGES as readonly Page[]).map((p) => p.id));
    const problems: string[] = [];
    for (const entry of ALSO_WRITTEN) {
      if (!ownersOf(entry.table).includes(entry.page))
        problems.push(`${entry.page}: does not own ${entry.table}`);
      for (const writer of entry.writers) {
        if (!ids.has(writer))
          problems.push(`${entry.table}: ${writer} is no page`);
        if (writer === entry.page)
          problems.push(`${entry.table}: ${writer} owns it already`);
      }
    }
    expect(problems).toEqual([]);
  });
});
