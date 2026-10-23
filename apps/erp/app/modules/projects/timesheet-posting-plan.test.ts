// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MissingAccountDefaultError } from "@carbon/database/journal-posting-status";
import { dilutionFactor } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import {
  type ProjectCostTreatment,
  type ProjectPostingContext,
  projectPostingKey
} from "./project-posting";
import {
  planDilution,
  planTimesheetPosting,
  type TimesheetLaborRate,
  type TimesheetOriginal,
  type TimesheetPostingEntry
} from "./timesheet-posting-plan";

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
          fixedAssetId: null,
          restrictCharging: false,
          memberIds: []
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
        assets: new Map(),
        accountAllowability: {}
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

const options = {
  postingStatus: "Posted" as const,
  accountDefaults: {
    laborAbsorptionAccount: "5030",
    retainedEarningsAccount: "3200"
  }
};

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
      new Map([["tse-1", booked({ costRate: 85, accountId: "6100" })]]),
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

  it("posts an empty labor absorption default to a stand-in line before the cutover", () => {
    const plan = planTimesheetPosting(
      [entry],
      contexts("Expense"),
      rates,
      new Map(),
      {
        postingStatus: "Provisional",
        accountDefaults: {
          laborAbsorptionAccount: null,
          retainedEarningsAccount: "3200"
        }
      }
    );
    expect(
      plan.lines.map((line) => [
        line.accountId,
        line.amount,
        line.accountDefaultRole
      ])
    ).toEqual([
      ["6100", 510, null],
      ["3200", -510, "laborAbsorptionAccount"]
    ]);
  });

  it("refuses an empty labor absorption default after the cutover", () => {
    expect(() =>
      planTimesheetPosting([entry], contexts("Expense"), rates, new Map(), {
        postingStatus: "Posted",
        accountDefaults: {
          laborAbsorptionAccount: null,
          retainedEarningsAccount: "3200"
        }
      })
    ).toThrow(MissingAccountDefaultError);
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

/** What a posted 6 h entry booked: 510.00 on one ledger row. */
function booked(overrides: Partial<TimesheetOriginal> = {}): TimesheetOriginal {
  return {
    id: "tse-1",
    costRate: 85,
    hours: 6,
    ledgerRowId: "pjl-1",
    postedAmount: 510,
    accountId: "1400",
    unallowable: false,
    fixedAssetId: null,
    postCapitalization: false,
    ...overrides
  };
}

describe("a correction follows what the original booked", () => {
  const reversal: TimesheetPostingEntry = {
    ...entry,
    id: "tse-2",
    hours: -6,
    reversalOfId: "tse-1"
  };

  it("credits the account the original debited, and keeps its unallowable flag, after the project moved from Contract to Expense", () => {
    const plan = planTimesheetPosting(
      [reversal],
      contexts("Expense"),
      rates,
      new Map([["tse-1", booked({ accountId: "1400", unallowable: true })]]),
      options
    );
    expect(plan.lines.map((line) => [line.accountId, line.amount])).toEqual([
      ["1400", -510],
      ["5030", 510]
    ]);
    expect(plan.ledgerRows[0]).toMatchObject({
      amount: -510,
      reversalOfId: "pjl-1",
      unallowable: true
    });
  });

  it("posts nothing for a reversal whose original posted nothing (a Statistical original)", () => {
    const plan = planTimesheetPosting(
      [reversal],
      contexts("Expense"),
      rates,
      new Map([
        [
          "tse-1",
          booked({ ledgerRowId: null, postedAmount: 0, accountId: null })
        ]
      ]),
      options
    );
    expect(plan.lines).toEqual([]);
    expect(plan.ledgerRows).toEqual([]);
    expect(plan.stamps).toEqual([
      { entryId: "tse-2", costRate: 85, treatment: "Expense" }
    ]);
  });

  it("reverses a diluted entry by exactly what it posted", () => {
    // 7 h at 85.00 diluted by 40/47: the original posted
    // round(7 × 85 × 40/47) = 506.38298 at the stamped rate 72.34043, and
    // round(7 × 72.34043) would be 506.38301.
    const plan = planTimesheetPosting(
      [{ ...reversal, hours: -7 }],
      contexts("Expense"),
      rates,
      new Map([
        [
          "tse-1",
          booked({
            hours: 7,
            costRate: 72.34043,
            postedAmount: 506.38298,
            accountId: "6100"
          })
        ]
      ]),
      options
    );
    expect(plan.ledgerRows[0]?.amount).toEqual(-506.38298);
    expect(plan.lines.map((line) => line.amount)).toEqual([
      -506.38298, 506.38298
    ]);
  });

  it("rebooks a replacement at the rate its original booked, not today's rate for the date", () => {
    // The rate for 2026-11-02 is 90.00 now; the original booked 85.00.
    const plan = planTimesheetPosting(
      [{ ...entry, id: "tse-3", entryDate: "2026-11-02", bookedRate: 85 }],
      contexts("Expense"),
      rates,
      new Map(),
      options
    );
    expect(plan.ledgerRows[0]?.amount).toEqual(510);
    expect(plan.stamps[0]?.costRate).toEqual(85);
  });
});

describe("dilution", () => {
  const rate60: TimesheetLaborRate[] = [
    { laborCategoryId: "lbc", effectiveFrom: "2026-01-01", costRate: 60 }
  ];
  // 50 h in one week: 10 h on each weekday.
  const week: TimesheetPostingEntry[] = [5, 6, 7, 8, 9].map((day) => ({
    ...entry,
    id: `tse-${day}`,
    entryDate: `2026-10-0${day}`,
    hours: 10
  }));

  it("posts an exempt employee's 50 h week at 60.00 as 2,400.00, at 48.00 an hour", () => {
    const factor = dilutionFactor(40, 50);
    const plan = planTimesheetPosting(
      week,
      contexts("Expense"),
      rate60,
      new Map(),
      {
        ...options,
        dilutionFactors: new Map(week.map((e) => [e.id, factor]))
      }
    );
    const total = plan.ledgerRows.reduce((sum, row) => sum + row.amount, 0);
    expect(total).toEqual(2400);
    expect(plan.stamps.map((stamp) => stamp.costRate)).toEqual([
      48, 48, 48, 48, 48
    ]);
    expect(plan.stamps.every((stamp) => stamp.dilutionFactor === 0.8)).toBe(
      true
    );
  });

  it("posts a Non-Exempt employee's 50 h at 60.00", () => {
    const plan = planTimesheetPosting(
      week,
      contexts("Expense"),
      rate60,
      new Map(),
      options
    );
    const total = plan.ledgerRows.reduce((sum, row) => sum + row.amount, 0);
    expect(total).toEqual(3000);
    expect(plan.stamps.map((stamp) => stamp.costRate)).toEqual([
      60, 60, 60, 60, 60
    ]);
  });

  it("re-dilutes the remaining 40 h to factor 1 when a correction removes 10 h", () => {
    const posted = week.slice(1).map((e) => ({
      id: e.id,
      hours: 10,
      costRate: 48,
      dilutionFactor: 0.8,
      postedAmount: 480
    }));
    const planned = planDilution([], posted, dilutionFactor(40, 40));
    expect(
      planned.adjustments.reduce((sum, row) => sum + row.amount, 0)
    ).toEqual(480);
    expect(planned.adjustments.map((row) => row.amount)).toEqual([
      120, 120, 120, 120
    ]);
    expect(planned.stamps.map((stamp) => stamp.costRate)).toEqual([
      60, 60, 60, 60
    ]);
  });
});
