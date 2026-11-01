// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type {
  PeriodCloseTaskRow,
  PeriodReadinessCheck,
  PeriodRunPreview
} from "./accounting.service";
import {
  checklistTasksToCreate,
  evaluateCloseChecklist,
  periodRunChecks
} from "./accounting.service";
import {
  fiscalYearPeriodDates,
  periodDeletionRefusal,
  periodPostingRefusal
} from "./accounting.utils";

function task(overrides: Partial<PeriodCloseTaskRow>): PeriodCloseTaskRow {
  return {
    id: "T",
    companyId: "C1",
    accountingPeriodId: "P2",
    definitionId: "D",
    name: "Task",
    taskType: "Manual",
    autoCheckKey: null,
    sortOrder: 1,
    required: true,
    severity: null,
    status: "Open",
    assigneeId: null,
    completedBy: null,
    completedAt: null,
    skippedReason: null,
    notes: null,
    ...overrides
  };
}

const draftJournalsTask = task({
  id: "auto1",
  taskType: "Auto",
  autoCheckKey: "draft-journals",
  severity: "Blocker",
  name: "Post or re-date draft journal entries"
});

function draftJournalsCheck(failing: boolean): PeriodReadinessCheck {
  return {
    autoCheckKey: "draft-journals",
    severity: "Blocker",
    label: "Draft journal entries dated in this period",
    failing,
    count: failing ? 2 : 0
  };
}

describe("checklistTasksToCreate", () => {
  it("creates a task per definition on first run and none on a re-run", () => {
    const defs = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];
    expect(checklistTasksToCreate(defs, []).map((d) => d.id)).toEqual([
      "d1",
      "d2",
      "d3"
    ]);
    expect(
      checklistTasksToCreate(defs, [
        { definitionId: "d1" },
        { definitionId: "d2" },
        { definitionId: "d3" }
      ])
    ).toEqual([]);
  });
});

describe("evaluateCloseChecklist", () => {
  it("blocks the close while a required manual task is Open, naming it", () => {
    const result = evaluateCloseChecklist(
      [task({ name: "Review financials" })],
      [],
      "Locked"
    );
    expect(result.canClose).toBe(false);
    expect(result.blockingReason).toMatch(/Review financials/);
  });

  it("blocks the close while a Blocker auto-check is failing", () => {
    const result = evaluateCloseChecklist(
      [draftJournalsTask],
      [draftJournalsCheck(true)],
      "Locked"
    );
    expect(result.canClose).toBe(false);
    expect(result.autoTaskStates).toEqual([]);
  });

  it("fails closed when an Auto task has no evaluator for its key", () => {
    const result = evaluateCloseChecklist(
      [task({ ...draftJournalsTask, autoCheckKey: "future-custom-check" })],
      [],
      "Locked"
    );
    expect(result.canClose).toBe(false);
  });

  it("does not let a skipped task hold the close", () => {
    const result = evaluateCloseChecklist(
      [task({ ...draftJournalsTask, status: "Skipped" })],
      [draftJournalsCheck(true)],
      "Locked"
    );
    expect(result.canClose).toBe(true);
  });

  it("allows the close and reports the Auto tasks whose stored status is stale", () => {
    const result = evaluateCloseChecklist(
      [draftJournalsTask, task({ status: "Done" })],
      [draftJournalsCheck(false)],
      "Locked"
    );
    expect(result).toMatchObject({
      canClose: true,
      blockingReason: null,
      autoTaskStates: [{ id: "auto1", status: "Done" }]
    });
  });

  it.each([
    ["Open", "Open", false],
    ["Locked", "Done", true],
    ["Closed", "Done", true]
  ] as const)(
    "treats the Lock task as done only once the period is locked (%s)",
    (closeStatus, effectiveStatus, canClose) => {
      const result = evaluateCloseChecklist(
        [task({ taskType: "Action", name: "Lock the period" })],
        [],
        closeStatus
      );
      expect(result.tasks[0]?.effectiveStatus).toBe(effectiveStatus);
      expect(result.canClose).toBe(canClose);
    }
  );
});

describe("periodPostingRefusal", () => {
  it.each([
    ["Open", "operational"],
    ["Open", "accounting"],
    ["Locked", "accounting"]
  ] as const)("lets a %s period take an %s posting", (status, source) => {
    expect(periodPostingRefusal(status, source)).toBeNull();
  });

  it.each([
    ["Locked", "operational"],
    ["Closed", "operational"],
    ["Closed", "accounting"]
  ] as const)("refuses a %s period an %s posting", (status, source) => {
    expect(periodPostingRefusal(status, source)).not.toBeNull();
  });
});

describe("periodDeletionRefusal", () => {
  it("allows deleting an open period with no journals", () => {
    expect(periodDeletionRefusal("Open", 0)).toBeNull();
  });

  it.each([
    ["an open period with journals posted to it", "Open", 3],
    ["a Locked period", "Locked", 0],
    ["a Closed period", "Closed", 0]
  ])("refuses %s", (_label, status, journals) => {
    expect(periodDeletionRefusal(status, journals)).not.toBeNull();
  });
});

describe("fiscalYearPeriodDates", () => {
  it("runs a March-start FY2027 from March 2026 to February 2027", () => {
    const rows = fiscalYearPeriodDates(2027, 3, new Set());
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      periodNumber: 1,
      startDate: "2026-03-01",
      endDate: "2026-03-31"
    });
    expect(rows[10]).toEqual({
      periodNumber: 11,
      startDate: "2027-01-01",
      endDate: "2027-01-31"
    });
    expect(rows[11]).toEqual({
      periodNumber: 12,
      startDate: "2027-02-01",
      endDate: "2027-02-28"
    });
  });

  it("keeps a January-start fiscal year inside its own calendar year", () => {
    const rows = fiscalYearPeriodDates(2028, 1, new Set());
    expect(rows[0]?.startDate).toBe("2028-01-01");
    expect(rows[1]?.endDate).toBe("2028-02-29");
    expect(rows[11]?.endDate).toBe("2028-12-31");
  });

  it("creates only the periods that do not exist yet", () => {
    const existing = new Set(
      Array.from({ length: 12 }, (_, i) => i + 1).filter((p) => p !== 5)
    );
    expect(fiscalYearPeriodDates(2027, 1, existing)).toEqual([
      { periodNumber: 5, startDate: "2027-05-01", endDate: "2027-05-31" }
    ]);
  });
});

describe("periodRunChecks", () => {
  const nothingDue: PeriodRunPreview = {
    revenue: { count: 0, amount: 0, error: null },
    lease: { count: 0, amount: 0, error: null },
    depreciation: { count: 0, amount: 0, error: null }
  };

  function base(
    overrides: Partial<Parameters<typeof periodRunChecks>[0]> = {}
  ) {
    return {
      runPreview: nothingDue,
      heldRunRows: { data: [], error: null },
      draftDepreciationRuns: { data: [], error: null },
      ...overrides
    };
  }

  function check(
    args: Parameters<typeof periodRunChecks>[0],
    key: string
  ): PeriodReadinessCheck | undefined {
    return periodRunChecks(args).find((c) => c.autoCheckKey === key);
  }

  const revenueRun = {
    id: "R1",
    runId: "RR-000001",
    periodEnd: "2026-09-30",
    type: "Revenue Recognition" as const
  };

  it("passes every run check when nothing is due and no Draft run waits", () => {
    expect(
      periodRunChecks(base()).map((c) => [c.autoCheckKey, c.failing, c.count])
    ).toEqual([
      ["draft-depreciation", false, 0],
      ["unposted-revenue-schedules", false, 0],
      ["unposted-lease-schedules", false, 0]
    ]);
  });

  it("adds what a Draft run holds to what a new run would claim, naming the run once", () => {
    // Preview 1 row / 25 + held rows 40 and 10 = 3 rows / 75.
    expect(
      check(
        base({
          runPreview: {
            ...nothingDue,
            revenue: { count: 1, amount: 25, error: null }
          },
          heldRunRows: {
            data: [
              { amount: 40, run: revenueRun },
              { amount: 10, run: revenueRun }
            ],
            error: null
          }
        }),
        "unposted-revenue-schedules"
      )
    ).toMatchObject({
      failing: true,
      count: 3,
      amount: 75,
      due: { count: 1, amount: 25 },
      draftRuns: [
        { id: "R1", readableId: "RR-000001", periodEnd: "2026-09-30" }
      ]
    });
  });

  it("counts a lease run's rows on the lease check only", () => {
    const args = base({
      runPreview: {
        ...nothingDue,
        lease: { count: 2, amount: 120, error: null }
      },
      heldRunRows: {
        data: [
          {
            amount: 30,
            run: { ...revenueRun, id: "L1", runId: "LR-000001", type: "Lease" }
          }
        ],
        error: null
      }
    });
    expect(check(args, "unposted-lease-schedules")).toMatchObject({
      failing: true,
      count: 3,
      amount: 150
    });
    expect(check(args, "unposted-revenue-schedules")).toMatchObject({
      failing: false,
      count: 0
    });
  });

  it("fails revenue when the preview could not run", () => {
    expect(
      check(
        base({
          runPreview: {
            ...nothingDue,
            revenue: {
              count: 0,
              amount: 0,
              error: "No Contract Assets account"
            }
          }
        }),
        "unposted-revenue-schedules"
      )
    ).toMatchObject({ failing: true, count: 0 });
  });

  it("fails both schedule checks closed when the held rows cannot be read", () => {
    const args = base({ heldRunRows: { data: null, error: { message: "x" } } });
    expect(check(args, "unposted-revenue-schedules")?.failing).toBe(true);
    expect(check(args, "unposted-lease-schedules")?.failing).toBe(true);
  });

  it("counts the assets a new run would depreciate plus each Draft depreciation run", () => {
    // 3 assets / 900 due + one Draft run of 60 + 40 = 4 / 1000.
    expect(
      check(
        base({
          runPreview: {
            ...nothingDue,
            depreciation: { count: 3, amount: 900, error: null }
          },
          draftDepreciationRuns: {
            data: [
              {
                id: "D1",
                depreciationRunId: "DEP-000001",
                periodEnd: "2026-10-31",
                depreciationRunLine: [{ amount: 60 }, { amount: 40 }]
              }
            ],
            error: null
          }
        }),
        "draft-depreciation"
      )
    ).toMatchObject({
      failing: true,
      count: 4,
      amount: 1000,
      draftRuns: [
        { id: "D1", readableId: "DEP-000001", periodEnd: "2026-10-31" }
      ]
    });
  });
});
