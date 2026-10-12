// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isFundedResearch,
  type Section6765Input,
  section6765Rows,
  taxYearBounds,
  wageQres,
  workCountryClass
} from "./rd-tax";

function component(
  index: number,
  overrides: Partial<Section6765Input> = {}
): Section6765Input {
  return {
    componentId: `bc${index}`,
    name: `Component ${String(index).padStart(2, "0")}`,
    componentType: "Product",
    softwareType: null,
    research: 0,
    supervision: 0,
    support: 0,
    supplies: 0,
    computerRental: 0,
    contractResearch: 0,
    ...overrides
  };
}

describe("workCountryClass", () => {
  it("classes Germany as Foreign, the US and Puerto Rico as Domestic, and no country as Unknown", () => {
    expect(workCountryClass("DE")).toBe("Foreign");
    expect(workCountryClass("US")).toBe("Domestic");
    expect(workCountryClass("PR")).toBe("Domestic");
    expect(workCountryClass(null)).toBe("Unknown");
  });
});

describe("taxYearBounds", () => {
  it("gives the calendar year for a January start", () => {
    expect(taxYearBounds(2026, 1)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31"
    });
  });

  it("gives July to June for a July start", () => {
    expect(taxYearBounds(2026, 7)).toEqual({
      from: "2026-07-01",
      to: "2027-06-30"
    });
  });
});

describe("isFundedResearch", () => {
  it("defaults from a Cost Plus line and keeps a stored false", () => {
    expect(
      isFundedResearch({
        researchFunded: null,
        hasCostPlusOrTimeAndMaterialsLine: true
      })
    ).toBe(true);
    expect(
      isFundedResearch({
        researchFunded: false,
        hasCostPlusOrTimeAndMaterialsLine: true
      })
    ).toBe(false);
  });
});

describe("wageQres", () => {
  it("qualifies all of the wages at 85 % of the hours (substantially all)", () => {
    const result = wageQres([
      {
        employeeId: "e1",
        wages: 100_000,
        totalHours: 2_000,
        isOfficer: false,
        qualified: [
          { componentId: "bc1", role: "Direct Research", hours: 1_700 }
        ]
      }
    ]);
    expect(result.byComponent.bc1).toEqual({
      research: 100_000,
      supervision: 0,
      support: 0
    });
  });

  it("qualifies the share of the wages at 50 % of the hours", () => {
    const result = wageQres([
      {
        employeeId: "e1",
        wages: 100_000,
        totalHours: 2_000,
        isOfficer: false,
        qualified: [
          { componentId: "bc1", role: "Direct Research", hours: 1_000 }
        ]
      }
    ]);
    expect(result.byComponent.bc1?.research).toBe(50_000);
  });

  it("adds an officer's qualified wages to officerWages", () => {
    const result = wageQres([
      {
        employeeId: "e1",
        wages: 100_000,
        totalHours: 2_000,
        isOfficer: true,
        qualified: [
          { componentId: "bc1", role: "Direct Supervision", hours: 600 },
          { componentId: "bc2", role: "Direct Support", hours: 400 }
        ]
      }
    ]);
    expect(result.byComponent.bc1?.supervision).toBe(30_000);
    expect(result.byComponent.bc2?.support).toBe(20_000);
    expect(result.officerWages).toBe(50_000);
  });
});

describe("section6765Rows", () => {
  it("counts 65 % of contract research", () => {
    const [row] = section6765Rows([component(1, { contractResearch: 10_000 })]);
    expect(row?.contractResearchQre).toBe(6_500);
    expect(row?.total).toBe(6_500);
  });

  it("lists 60 components in descending order up to 80 % or 50 rows, then one aggregate row", () => {
    const components = Array.from({ length: 60 }, (_, i) =>
      component(i + 1, { research: (i + 1) * 1_000 })
    );
    const rows = section6765Rows(components);
    const listed = rows.filter((r) => !r.isAggregate);
    const aggregate = rows.filter((r) => r.isAggregate);
    const grandTotal = components.reduce((sum, c) => sum + c.research, 0);
    const listedTotal = listed.reduce((sum, r) => sum + r.total, 0);

    for (let i = 1; i < listed.length; i++) {
      expect(listed[i - 1]!.total).toBeGreaterThanOrEqual(listed[i]!.total);
    }
    expect(listed.length <= 50).toBe(true);
    expect(listedTotal >= grandTotal * 0.8 || listed.length === 50).toBe(true);
    // Without its last row, the list would be short of 80 %.
    expect(listedTotal - listed[listed.length - 1]!.total).toBeLessThan(
      grandTotal * 0.8
    );
    expect(aggregate).toHaveLength(1);
    expect(rows[rows.length - 1]).toBe(aggregate[0]);
    expect(aggregate[0]?.name).toBe(
      `All other business components (${60 - listed.length})`
    );
  });

  it("keeps the grand total across the listed rows and the aggregate row", () => {
    const components = Array.from({ length: 60 }, (_, i) =>
      component(i + 1, {
        research: 1_234.56 * (i + 1),
        supplies: 100.1 * (i % 7),
        contractResearch: 333.33 * (i % 3)
      })
    );
    const rows = section6765Rows(components);
    const grandTotal = components.reduce(
      (sum, c) => sum + c.research + c.supplies + c.contractResearch * 0.65,
      0
    );
    const rowsTotal = rows.reduce((sum, r) => sum + r.total, 0);
    expect(rowsTotal).toBeCloseTo(grandTotal, 4);
  });
});
