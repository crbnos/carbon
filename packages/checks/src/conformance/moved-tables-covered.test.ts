// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  findMovedTableGaps,
  type MovedTablesRegistry
} from "./moved-tables-covered";

/** production.forecasts owns demandForecast; sales.orders owns salesOrder and lets inventory.shipments write it. */
const OWNERS: Record<string, string[]> = {
  demandForecast: ["production.forecasts"],
  salesOrder: ["sales.orders"],
  shipment: ["inventory.shipments"]
};

const registry = (
  alsoWrittenBy: Record<string, Record<string, string[]>> = {
    "sales.orders": { salesOrder: ["inventory.shipments"] }
  }
): MovedTablesRegistry => ({
  pages: [
    {
      id: "production.forecasts",
      maxLevel: "Full",
      alsoWrittenBy: alsoWrittenBy["production.forecasts"]
    },
    {
      id: "sales.orders",
      maxLevel: "Edit",
      alsoWrittenBy: alsoWrittenBy["sales.orders"]
    },
    { id: "inventory.shipments", maxLevel: "Full" }
  ],
  ownersOf: (table) => OWNERS[table] ?? [],
  moduleEnumOf: (page) => {
    const id = page.slice(0, page.indexOf("."));
    return id.charAt(0).toUpperCase() + id.slice(1);
  }
});

const migration = (rows: string) => ({
  file: "<inline>.sql",
  contents: `WITH moved (old_module, new_module, page, cap) AS (
  VALUES
${rows}
),
typed AS (
  SELECT 1
)
SELECT 1;
`
});

const GOOD = `  ('Inventory', 'Production', 'production.forecasts', 'Full') -- demandForecast, the page's only table`;

describe("findMovedTableGaps", () => {
  it("passes a table granted on its new page and not in alsoWrittenBy", () => {
    expect(findMovedTableGaps(migration(GOOD), registry())).toEqual([]);
  });

  it("fails a migration whose rows cannot be found", () => {
    const violations = findMovedTableGaps(
      { file: "<inline>.sql", contents: "SELECT 1;" },
      registry()
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("no `moved` rows");
  });

  it("fails a table covered by both a grant and alsoWrittenBy", () => {
    const violations = findMovedTableGaps(
      migration(GOOD),
      registry({
        "production.forecasts": { demandForecast: ["inventory.shipments"] }
      })
    );
    const messages = violations.map((v) => v.message);
    expect(messages.some((m) => m.includes("covered twice"))).toBe(true);
    expect(
      messages.some((m) => m.includes("production.forecasts gets a grant"))
    ).toBe(true);
  });

  it("fails a table covered by neither", () => {
    // The grant is on sales.orders, which does not own demandForecast.
    const violations = findMovedTableGaps(
      migration(
        `  ('Inventory', 'Sales', 'sales.orders', 'Edit') -- demandForecast moved here`
      ),
      registry({})
    );
    expect(violations.map((v) => v.snippet)).toEqual(["demandForecast"]);
    expect(violations[0]?.message).toContain("neither");
  });

  it("fails a cap that is not the page's maxLevel", () => {
    const violations = findMovedTableGaps(
      migration(
        `  ('Inventory', 'Production', 'production.forecasts', 'Edit') -- demandForecast`
      ),
      registry()
    );
    expect(violations.map((v) => v.snippet)).toEqual(["Edit"]);
    expect(violations[0]?.message).toContain("maxLevel Full");
  });

  it("fails a page that is not in the registry, or not in the row's new module", () => {
    const violations = findMovedTableGaps(
      migration(
        [
          `  ('Inventory', 'Production', 'production.nowhere', 'Full'), -- demandForecast`,
          `  ('Inventory', 'Sales', 'production.forecasts', 'Full') -- demandForecast`
        ].join("\n")
      ),
      registry()
    );
    expect(violations.map((v) => v.snippet)).toEqual([
      "production.nowhere",
      "Sales"
    ]);
  });

  it("ignores comment words that name no table", () => {
    expect(
      findMovedTableGaps(
        migration(
          `  ('Inventory', 'Production', 'production.forecasts', 'Full') -- demandForecast; besides it only planningAction, which nobody writes`
        ),
        registry()
      )
    ).toEqual([]);
  });
});
