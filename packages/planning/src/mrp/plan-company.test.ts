// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The golden test of the MRP planning core. The fixture holds the inputs of a
// satellite dataset company (a Make item with a 2-level BOM, Buy items, open
// PO lines and jobs, sales order lines, demand projections and a Consume First
// supersession). The snapshot pins the output row for row.
//
// Never edit the snapshot to make a change pass. If it changes, the change
// changed what MRP plans for a company with no project stock.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type PlanCompanyInputs,
  type PlanCompanyOutputs,
  planCompany
} from "./plan-company";

function loadFixture(name: string): PlanCompanyInputs {
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")
  ) as PlanCompanyInputs;
}

const KEY_COLUMNS = ["itemId", "locationId", "periodId", "sourceType"] as const;

// Sorts each output by its key columns, then by the whole row, so the snapshot
// does not depend on Map iteration order.
function sortRows<T extends object>(rows: T[]): T[] {
  const keyOf = (row: T) => {
    const record = row as Record<string, unknown>;
    return [
      ...KEY_COLUMNS.map((column) => String(record[column] ?? "")),
      JSON.stringify(row)
    ].join("\u001f");
  };
  return [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function sorted(outputs: PlanCompanyOutputs) {
  return {
    demandForecastUpserts: sortRows(outputs.demandForecastUpserts),
    demandForecastSourceInserts: sortRows(outputs.demandForecastSourceInserts),
    demandActualUpserts: sortRows(outputs.demandActualUpserts),
    supplyActualUpserts: sortRows(outputs.supplyActualUpserts),
    consumptionUpdates: sortRows(outputs.consumptionUpdates),
    cycleItemIds: [...outputs.cycleItemIds].sort()
  };
}

describe("planCompany", () => {
  it("plans the satellite dataset company as before (golden)", () => {
    const outputs = planCompany(loadFixture("plan-company.basic.json"));
    expect(sorted(outputs)).toMatchSnapshot();
  });
});
