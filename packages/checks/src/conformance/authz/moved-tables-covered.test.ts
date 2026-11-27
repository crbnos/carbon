// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { movedTablesCovered } from "./moved-tables-covered";

// demandForecast moved from Inventory (write and read) to a Production page.
const policy = (command: string, keys: string) =>
  `CREATE POLICY "${command}" ON "public"."demandForecast" FOR ${command} USING (${keys});`;

const demandForecastGaps = (sql: string) =>
  movedTablesCovered
    .find({ migrations: [{ file: "1_ship.sql", contents: sql }] })
    .filter((v) => v.snippet === "demandForecast")
    .map((v) => v.message);

describe("movedTablesCovered", () => {
  it("reads the frozen base and the registry: a moved table keeps its old module", () => {
    expect(
      demandForecastGaps(
        [
          policy(
            "SELECT",
            "get_companies_with_module_view(ARRAY['production']::text[], ARRAY['inventory.quantities_view']::text[])"
          ),
          policy(
            "INSERT",
            "get_companies_with_any_employee_permission(ARRAY['production.forecasts_create', 'inventory.quantities_create'])"
          )
        ].join("\n")
      )
    ).toEqual([]);
    const gaps = demandForecastGaps(
      policy("INSERT", "'production.forecasts_create'")
    );
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatch(
      /^demandForecast moved from Inventory to production\.\w+, and no write policy checks a page of Inventory/
    );
    expect(gaps[1]).toMatch(
      /^demandForecast moved from Inventory to production\.\w+, and its SELECT admits no page of Inventory/
    );
  });
});
