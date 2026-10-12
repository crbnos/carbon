// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildSection174ARows,
  buildSection6765Input,
  type RdComponent,
  type RdEmployeeYear,
  type RdLedgerRow
} from "~/modules/projects/projects.models";

const components: RdComponent[] = [
  {
    id: "bc1",
    readableId: "ST-1",
    name: "Star tracker optics",
    rdComponentType: "Product",
    rdSoftwareType: null
  }
];

/** A Direct Research timesheet row of 10 hours on `bc1`. */
function time(overrides: Partial<RdLedgerRow> = {}): RdLedgerRow {
  return {
    componentId: "bc1",
    costType: "Labor",
    documentType: "Timesheet",
    amount: 1_000,
    employeeId: "e1",
    quantity: 10,
    countryCode: "US",
    rdActivityRole: "Direct Research",
    costObjective: "IR&D",
    funded: false,
    ...overrides
  };
}

function employee(overrides: Partial<RdEmployeeYear> = {}): RdEmployeeYear {
  return {
    employeeId: "e1",
    employeeName: "Ada",
    totalHours: 10,
    grossWages: 2_000,
    laborAmount: 1_000,
    isOfficer: false,
    ...overrides
  };
}

describe("buildSection174ARows", () => {
  it("adds time at a location in Germany to the Foreign column", () => {
    const [row, total] = buildSection174ARows(
      [time({ countryCode: "DE", amount: 800 })],
      components
    );
    expect(row).toMatchObject({ domestic: 0, foreign: 800, unknown: 0 });
    expect(total).toMatchObject({ isTotal: true, foreign: 800, total: 800 });
  });

  it("adds time at a US location to Domestic, and a location with no country to Unknown", () => {
    const [row] = buildSection174ARows(
      [time({ amount: 500 }), time({ countryCode: null, amount: 300 })],
      components
    );
    expect(row).toMatchObject({ domestic: 500, unknown: 300, total: 800 });
  });
});

describe("buildSection6765Input", () => {
  it("gives no wage QRE for time on a Direct project under a funded contract, which shows as funded", () => {
    const funded = time({ costObjective: "Direct", funded: true });
    const input = buildSection6765Input([funded], [employee()], components);
    expect(input.components).toHaveLength(0);
    expect(buildSection174ARows([funded], components)[0]?.funded).toBe(1_000);
  });

  it("uses the labor cost for an employee with no payroll rows, and counts the estimate", () => {
    const input = buildSection6765Input(
      [time()],
      [employee({ grossWages: null, laborAmount: 1_000 })],
      components
    );
    expect(input.estimatedEmployeeCount).toBe(1);
    expect(input.components[0]?.research).toBe(1_000);
  });
});
