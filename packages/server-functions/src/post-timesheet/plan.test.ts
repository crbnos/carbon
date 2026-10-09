// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type ProjectCostTreatment,
  type ProjectPostingContext,
  projectPostingKey
} from "../lib/project-posting";
import {
  planTimesheetPosting,
  type TimesheetLaborRate,
  type TimesheetPostingEntry
} from "./plan";

function contexts(
  costTreatment: ProjectCostTreatment
): Map<string, ProjectPostingContext> {
  return new Map([
    [
      projectPostingKey("proj", null),
      {
        project: {
          id: "proj",
          status: "Released",
          costTreatment,
          costAccountId: null,
          fixedAssetId: null
        },
        element: null,
        ancestors: [],
        defaults: {
          projectExpenseAccount: "6100",
          projectWorkInProgressAccount: "1400",
          warrantyExpenseAccount: "6120",
          costOfGoodsSoldAccount: "5010",
          workInProgressAccount: "1230"
        },
        assets: new Map()
      }
    ]
  ]);
}

const entry: TimesheetPostingEntry = {
  id: "tse-1",
  employeeId: "emp",
  entryDate: "2026-10-05",
  projectId: "proj",
  projectElementId: null,
  laborCategoryId: "lbc",
  hours: 6,
  reversalOfId: null
};

const rates: TimesheetLaborRate[] = [
  { laborCategoryId: "lbc", effectiveFrom: "2026-01-01", costRate: 85 },
  { laborCategoryId: "lbc", effectiveFrom: "2026-11-01", costRate: 90 }
];

const options = { accountingEnabled: true, laborAbsorptionAccount: "5030" };

describe("planTimesheetPosting", () => {
  it("posts 6 h at 85.00 to the expense account against labor absorption", () => {
    const plan = planTimesheetPosting(
      [entry],
      contexts("Expense"),
      rates,
      new Map(),
      options
    );
    expect(plan.lines.map((line) => [line.accountId, line.amount])).toEqual([
      ["6100", 510],
      ["5030", -510]
    ]);
    expect(plan.ledgerRows).toHaveLength(1);
    expect(plan.ledgerRows[0]).toMatchObject({
      amount: 510,
      quantity: 6,
      reversalOfId: null
    });
    expect(plan.stamps).toEqual([
      { entryId: "tse-1", costRate: 85, treatment: "Expense" }
    ]);
  });

  it("reverses at the original rate even when today's rate is higher", () => {
    const reversal: TimesheetPostingEntry = {
      ...entry,
      id: "tse-2",
      entryDate: "2026-11-02",
      hours: -6,
      reversalOfId: "tse-1"
    };
    const plan = planTimesheetPosting(
      [reversal],
      contexts("Expense"),
      rates,
      new Map([["tse-1", { id: "tse-1", costRate: 85, ledgerRowId: "pjl-1" }]]),
      options
    );
    expect(plan.lines.map((line) => [line.accountId, line.amount])).toEqual([
      ["6100", -510],
      ["5030", 510]
    ]);
    expect(plan.ledgerRows[0]).toMatchObject({
      amount: -510,
      reversalOfId: "pjl-1"
    });
    expect(plan.stamps[0]?.costRate).toEqual(85);
  });

  it("posts nothing for a Statistical project", () => {
    const plan = planTimesheetPosting(
      [entry],
      contexts("Statistical"),
      rates,
      new Map(),
      options
    );
    expect(plan.lines).toEqual([]);
    expect(plan.ledgerRows).toEqual([]);
    expect(plan.stamps).toHaveLength(1);
  });
});
