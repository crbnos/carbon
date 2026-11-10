// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The helper files and the moved-tables migration are checked against the
// registry by @carbon/checks: `registry-helpers-fresh` and `moved-tables-covered`.

import { describe, expect, test } from "vitest";
import { PAGES, type Page, placeOf } from "../access/registry";

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

describe("tables that moved to another module's page", () => {
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
