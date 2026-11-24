// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  BASE_TABLE_MODULES,
  findMovedTableGaps,
  livePolicies,
  type MovedTablesRegistry
} from "./moved-tables-covered";

/** demandForecast moved from Inventory (write and read) to production.forecasts. */
const BASE = {
  demandForecast: { read: ["inventory"], write: ["inventory"] },
  salesOrder: { read: [], write: ["sales"] },
  printerRoute: { read: [], write: ["printing"] },
  dropped: { read: [], write: ["inventory"] }
};

const OWNERS: Record<string, string[]> = {
  demandForecast: ["production.forecasts"],
  salesOrder: ["sales.orders"],
  printerRoute: ["settings.printing"]
};

const registry: MovedTablesRegistry = {
  ownersOf: (table) => OWNERS[table] ?? [],
  moduleOf: (page) => page.slice(0, page.indexOf(".")),
  hasPages: (module) => module !== "printing"
};

const policy = (command: string, keys: string) =>
  `CREATE POLICY "${command}" ON "public"."demandForecast" FOR ${command} USING (${keys});`;

const gaps = (sql: string) =>
  findMovedTableGaps(
    livePolicies([{ file: "1_ship.sql", contents: sql }]),
    registry,
    BASE
  ).map((v) => v.message);

const COVERED = [
  policy(
    "SELECT",
    "get_companies_with_module_view(ARRAY['production']::text[], ARRAY['inventory.quantities_view']::text[])"
  ),
  policy(
    "INSERT",
    "get_companies_with_any_employee_permission(ARRAY['production.forecasts_create', 'inventory.quantities_create'])"
  )
].join("\n");

describe("findMovedTableGaps", () => {
  it("passes a moved table whose policies still admit its old module", () => {
    expect(gaps(COVERED)).toEqual([]);
  });

  it("fails a moved table no write policy lets its old module write", () => {
    expect(
      gaps(COVERED.replace("'inventory.quantities_create'", "'x'"))
    ).toEqual([
      "demandForecast moved from Inventory to production.forecasts, and no write policy checks a page of Inventory: list it in its page's alsoWrittenBy with a page of Inventory, then run authz migration"
    ]);
  });

  it("fails a moved table whose SELECT no longer admits its old module", () => {
    expect(gaps(COVERED.replace("'inventory.quantities_view'", "'x'"))).toEqual(
      [
        "demandForecast moved from Inventory to production.forecasts, and its SELECT admits no page of Inventory: list it in the readers of a page of Inventory, then run authz migration"
      ]
    );
  });

  it("reads a table's policies from the last migration that sets them", () => {
    const later = [
      policy(
        "SELECT",
        "get_companies_with_module_view(ARRAY['production']::text[], '{}'::text[])"
      ),
      policy("INSERT", "'production.forecasts_create'")
    ].join("\n");
    const live = livePolicies([
      { file: "1_ship.sql", contents: COVERED },
      { file: "2_ship.sql", contents: later }
    ]);
    expect(findMovedTableGaps(live, registry, BASE)).toHaveLength(2);
  });

  it("skips a table still in its module, one from a module with no pages, and one no page owns", () => {
    expect(gaps("").map((m) => m.slice(0, m.indexOf(" ")))).toEqual([
      "demandForecast",
      "demandForecast"
    ]);
  });

  it("knows the modules each table's policies checked on main", () => {
    expect({
      eventSystemSubscription: BASE_TABLE_MODULES.eventSystemSubscription,
      qualityDocumentStep: BASE_TABLE_MODULES.qualityDocumentStep,
      quoteOperationParameter: BASE_TABLE_MODULES.quoteOperationParameter,
      itemPostingGroup: BASE_TABLE_MODULES.itemPostingGroup,
      trainingCompletion: BASE_TABLE_MODULES.trainingCompletion,
      demandActual: BASE_TABLE_MODULES.demandActual
    }).toEqual({
      eventSystemSubscription: { read: [], write: ["settings"] },
      qualityDocumentStep: { read: [], write: ["production"] },
      quoteOperationParameter: { read: [], write: ["parts"] },
      itemPostingGroup: { read: ["accounting"], write: ["accounting"] },
      trainingCompletion: {
        read: ["resources"],
        write: ["people", "resources"]
      },
      demandActual: { read: ["inventory", "parts"], write: ["inventory"] }
    });
  });
});
