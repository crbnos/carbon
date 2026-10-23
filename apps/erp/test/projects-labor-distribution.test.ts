// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildLaborDistribution,
  type LaborDistributionLaborRow,
  NO_PAYROLL_IMPORTED
} from "~/modules/projects/projects.models";

function labor(
  extra: Partial<LaborDistributionLaborRow>
): LaborDistributionLaborRow {
  return {
    employeeId: "emp-1",
    employeeName: "Ada Lovelace",
    projectId: "p-direct",
    projectIdentifier: "DIR",
    projectName: "Direct contract",
    costObjective: "Direct",
    projectElementId: null,
    elementReadableId: null,
    elementName: null,
    hours: 10,
    amount: 1000,
    unallowableAmount: 0,
    ...extra
  };
}

describe("buildLaborDistribution", () => {
  it("puts labor on a Direct, an IR&D and an unclassified project in three columns", () => {
    const [employee] = buildLaborDistribution({
      labor: [
        labor({ projectId: "p-direct", costObjective: "Direct", amount: 1000 }),
        labor({
          projectId: "p-ird",
          projectIdentifier: "IRD",
          costObjective: "IR&D",
          amount: 600
        }),
        labor({
          projectId: "p-none",
          projectIdentifier: "NONE",
          costObjective: null,
          amount: 400
        })
      ],
      timecards: [],
      payroll: []
    });

    expect(
      employee!.lines.map((line) => [
        line.chargeNumber,
        line.direct,
        line.indirect,
        line.unclassified
      ])
    ).toEqual([
      ["DIR", 1000, 0, 0],
      ["IRD", 0, 600, 0],
      ["NONE", 0, 0, 400]
    ]);
    expect(employee!.total).toMatchObject({
      direct: 1000,
      indirect: 600,
      unclassified: 400,
      unallowable: 0,
      total: 2000,
      hours: 30
    });
  });

  it("adds an unallowable row to the Unallowable column", () => {
    const [employee] = buildLaborDistribution({
      labor: [
        labor({ amount: 1000 }),
        labor({
          projectElementId: "el-1",
          elementReadableId: "DIR-4",
          amount: 250,
          unallowableAmount: 250
        })
      ],
      timecards: [],
      payroll: []
    });

    expect(employee!.lines[1]).toMatchObject({
      chargeNumber: "DIR-4",
      direct: 0,
      unallowable: 250,
      total: 250
    });
    expect(employee!.total).toMatchObject({
      direct: 1000,
      unallowable: 250,
      total: 1250
    });
  });

  it("shows payroll of 4,000.00 against 3,900.00 of labor as a difference of -100.00", () => {
    const [employee] = buildLaborDistribution({
      labor: [labor({ hours: 39, amount: 3900 })],
      timecards: [{ employeeId: "emp-1", employeeName: "Ada Lovelace", hours: 40 }],
      payroll: [
        {
          employeeId: "emp-1",
          employeeName: "Ada Lovelace",
          grossWages: 4000,
          hoursPaid: 40
        }
      ]
    });

    expect(employee!.total).toMatchObject({
      total: 3900,
      grossWages: 4000,
      dollarsDifference: -100,
      timecardHours: 40,
      hoursDifference: -1,
      note: null
    });
  });

  it("says No payroll imported when the employee has no payroll row", () => {
    const [employee] = buildLaborDistribution({
      labor: [labor({})],
      timecards: [],
      payroll: []
    });

    expect(employee!.total).toMatchObject({
      grossWages: null,
      dollarsDifference: null,
      note: NO_PAYROLL_IMPORTED
    });
    expect(NO_PAYROLL_IMPORTED).toBe("No payroll imported");
  });
});
