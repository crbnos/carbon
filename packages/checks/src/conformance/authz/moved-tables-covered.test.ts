// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { movedTablesCovered } from "./moved-tables-covered";

// demandForecast moved from Inventory (write and read) to production.forecasts.
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

const registry = {
  ownersOf: (table: string) => OWNERS[table] ?? [],
  moduleOf: (page: string) => page.slice(0, page.indexOf(".")),
  hasPages: (module: string) => module !== "printing",
  label: (module: string) => module.charAt(0).toUpperCase() + module.slice(1)
};

const policy = (
  command: string,
  keys: string,
  table = '"public"."demandForecast"'
) => `CREATE POLICY "${command}" ON ${table} FOR ${command} USING (${keys});`;

const gapsAfter = (...migrations: string[]) =>
  movedTablesCovered
    .find({
      migrations: migrations.map((contents, i) => ({
        file: `${i + 1}_ship.sql`,
        contents
      })),
      base: BASE,
      registry
    })
    .map((v) => v.message);

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

const NO_WRITE =
  "demandForecast moved from Inventory to production.forecasts, and no write policy checks a page of Inventory: list it in its page's alsoWrittenBy with a page of Inventory, then run authz migration";
const NO_READ =
  "demandForecast moved from Inventory to production.forecasts, and its SELECT admits no page of Inventory: list it in the readers of a page of Inventory, then run authz migration";

describe("movedTablesCovered", () => {
  it("passes a moved table whose policies still admit its old module", () => {
    expect(gapsAfter(COVERED)).toEqual([]);
  });

  it("fails a moved table no write policy lets its old module write", () => {
    expect(
      gapsAfter(COVERED.replace("'inventory.quantities_create'", "'x'"))
    ).toEqual([NO_WRITE]);
  });

  it("fails a moved table whose SELECT no longer admits its old module", () => {
    expect(
      gapsAfter(COVERED.replace("'inventory.quantities_view'", "'x'"))
    ).toEqual([NO_READ]);
  });

  it("reads a table's policies from the last migration that sets them", () => {
    const later = [
      policy(
        "SELECT",
        "get_companies_with_module_view(ARRAY['production']::text[], '{}'::text[])"
      ),
      policy("INSERT", "'production.forecasts_create'")
    ].join("\n");
    expect(gapsAfter(COVERED, later)).toEqual([NO_WRITE, NO_READ]);
  });

  it("skips a table still in its module, one from a module with no pages, and one no page owns", () => {
    expect(gapsAfter("")).toEqual([NO_WRITE, NO_READ]);
  });

  it("reads a policy with no FOR clause as ALL", () => {
    expect(
      gapsAfter(
        `CREATE POLICY "Everything" ON "demandForecast" USING ('inventory.quantities_view' AND 'inventory.quantities_create');`
      )
    ).toEqual([]);
  });

  it("reads only the policies of public tables", () => {
    expect(
      gapsAfter(
        COVERED.replaceAll(
          '"public"."demandForecast"',
          'storage."demandForecast"'
        )
      )
    ).toEqual([NO_WRITE, NO_READ]);
  });
});
