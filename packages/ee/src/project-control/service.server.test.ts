// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";

const companyHasFeature = vi.hoisted(() => vi.fn());
vi.mock("../plan.server", () => ({ companyHasFeature }));

import {
  type EarnedValueElement,
  parseEarnedValueBaseline
} from "./loaders.server";
import { budgetNotices, budgetOverrunMessage } from "./models";
import {
  checkBudgetAvailability,
  computeProjectEarnedValue
} from "./service.server";

// A Kysely stand-in: every builder method returns the chain, and `execute`
// returns the rows of the table the chain started from. It records each
// table it reads.
function fakeDb(rowsByTable: Record<string, Record<string, unknown>[]>) {
  const reads: string[] = [];
  const db = {
    selectFrom: (from: string) => {
      const table = from.split(" ")[0] as string;
      const chain: Record<string, unknown> = {};
      for (const method of [
        "select",
        "where",
        "innerJoin",
        "groupBy",
        "orderBy"
      ]) {
        chain[method] = () => chain;
      }
      chain.$if = (condition: boolean, apply: (qb: unknown) => unknown) =>
        condition ? apply(chain) : chain;
      chain.execute = async () => {
        reads.push(table);
        return rowsByTable[table] ?? [];
      };
      return chain;
    }
  };
  return { db: db as never, reads };
}

const elements = [
  {
    id: "wbs-1",
    projectId: "p1",
    parentId: null,
    budget: 10000,
    readableId: "1",
    name: "Optics"
  },
  {
    id: "wbs-1.1",
    projectId: "p1",
    parentId: "wbs-1",
    budget: null,
    readableId: "1.1",
    name: "Lens"
  },
  {
    id: "wbs-1.1.1",
    projectId: "p1",
    parentId: "wbs-1.1",
    budget: null,
    readableId: "1.1.1",
    name: "Coating"
  }
];

function blockProjectDb() {
  return fakeDb({
    project: [
      {
        id: "p1",
        name: "Star Tracker",
        budgetControl: "Block",
        budgetTolerancePercent: null,
        ownerId: "manager-1"
      }
    ],
    projectElement: elements,
    purchaseOrderLine: [{ projectElementId: "wbs-1.1", amount: 6000 }],
    projectLedger: [{ projectElementId: "wbs-1", amount: 3000 }]
  });
}

const charge = {
  projectId: "p1",
  projectElementId: "wbs-1.1.1",
  amount: 1500
};

describe("checkBudgetAvailability", () => {
  beforeEach(() => {
    companyHasFeature.mockReset();
  });

  it("returns ok and runs no query without the feature", async () => {
    companyHasFeature.mockResolvedValue(false);
    const { db, reads } = blockProjectDb();

    const result = await checkBudgetAvailability(db, {} as never, {
      companyId: "c1",
      source: "purchase",
      charges: [charge]
    });

    expect(result).toEqual({ status: "ok", overruns: [] });
    expect(reads).toEqual([]);
  });

  it("blocks a purchase that takes a Block project's element over budget", async () => {
    companyHasFeature.mockResolvedValue(true);
    const { db } = blockProjectDb();

    const result = await checkBudgetAvailability(db, {} as never, {
      companyId: "c1",
      source: "purchase",
      charges: [charge]
    });

    expect(result.status).toBe("block");
    expect(result.overruns).toHaveLength(1);
    expect(result.overruns[0]).toMatchObject({
      elementId: "wbs-1",
      budget: 10000,
      projected: 10500,
      overBy: 500,
      ownerId: "manager-1"
    });
    expect(budgetOverrunMessage(result, (n) => n.toString())).toBe(
      "1 Optics goes over its budget of 10000 by 500."
    );
  });

  it("only warns when the same overrun comes from a timesheet", async () => {
    companyHasFeature.mockResolvedValue(true);
    const { db } = blockProjectDb();

    const result = await checkBudgetAvailability(db, {} as never, {
      companyId: "c1",
      source: "timesheet",
      charges: [charge]
    });

    expect(result.status).toBe("warn");
    expect(result.overruns).toHaveLength(1);
  });

  it("counts open planning group supply pegged to the project as committed", async () => {
    companyHasFeature.mockResolvedValue(true);
    // 4,000 on the project's own PO lines plus 2,000 of grouped supply
    // pegged to the element is 6,000 committed, as the Costs tab shows it.
    const { db, reads } = fakeDb({
      project: [
        {
          id: "p1",
          name: "Star Tracker",
          budgetControl: "Block",
          budgetTolerancePercent: null,
          ownerId: "manager-1"
        }
      ],
      projectElement: elements,
      purchaseOrderLine: [{ projectElementId: "wbs-1.1", amount: 4000 }],
      projectPeg: [{ projectElementId: "wbs-1.1.1", amount: 2000 }],
      projectLedger: [{ projectElementId: "wbs-1", amount: 3000 }]
    });

    const result = await checkBudgetAvailability(db, {} as never, {
      companyId: "c1",
      source: "purchase",
      charges: [charge]
    });

    expect(reads).toContain("projectPeg");
    expect(result.status).toBe("block");
    expect(result.overruns[0]).toMatchObject({
      projected: 10500,
      overBy: 500
    });
  });
});

describe("budgetNotices", () => {
  const overrun = {
    projectName: "Star Tracker",
    elementId: "wbs-1",
    readableId: "ST-1",
    elementName: "Optics",
    budget: 10000,
    projected: 10500,
    overBy: 500
  };

  it("sends one notice per Block project with an owner, never for Warn", () => {
    const notices = budgetNotices(
      {
        overruns: [
          {
            ...overrun,
            projectId: "p1",
            budgetControl: "Block",
            ownerId: "manager-1"
          },
          {
            ...overrun,
            projectId: "p2",
            budgetControl: "Warn",
            ownerId: "manager-2"
          },
          {
            ...overrun,
            projectId: "p3",
            budgetControl: "Block",
            ownerId: null
          }
        ]
      },
      (n) => n.toString()
    );

    expect(notices).toEqual([
      {
        projectId: "p1",
        ownerId: "manager-1",
        title: "Budget exceeded on Star Tracker",
        body: "ST-1 Optics goes over its budget of 10000 by 500."
      }
    ]);
  });
});

describe("computeProjectEarnedValue", () => {
  const element = (
    id: string,
    parentId: string | null,
    fields: Partial<EarnedValueElement> = {}
  ): EarnedValueElement => ({
    id,
    parentId,
    readableId: id.toUpperCase(),
    name: `Element ${id}`,
    isChargeable: true,
    isControlAccount: false,
    controlAccountManagerId: null,
    earnedValueTechnique: null,
    earnedValuePercent: null,
    apportionedToElementId: null,
    apportionedFactor: null,
    stateGroup: "Unstarted",
    ...fields
  });

  const project = (baseline: boolean) => ({
    projectId: "p1",
    elements: [
      element("ca", null, { isControlAccount: true, isChargeable: false }),
      element("wp", "ca", {
        earnedValueTechnique: "50/50",
        stateGroup: "Started"
      }),
      element("wp-task", "wp"),
      element("qa", "ca", {
        earnedValueTechnique: "Apportioned",
        apportionedToElementId: "wp",
        apportionedFactor: 0.1
      }),
      element("orphan", null, { earnedValueTechnique: "0/100" })
    ],
    baseline: baseline
      ? parseEarnedValueBaseline("pb1", {
          elements: [
            { id: "ca", parentId: null, budget: null },
            { id: "wp", parentId: "ca", budget: 10000 },
            { id: "wp-task", parentId: "wp", budget: null },
            { id: "qa", parentId: "ca", budget: 1000 }
          ],
          schedule: [
            { id: "wp", startDate: "2026-10-01", targetDate: "2026-12-31" },
            { id: "qa", startDate: "2026-10-01", targetDate: "2026-12-31" }
          ]
        })
      : null
  });

  const totals = (direct: number, burden: number, hours: number) => ({
    hours,
    byElement: {
      Labor: direct,
      Material: 0,
      Subcontract: 0,
      "Other Direct": 0,
      Overhead: burden,
      "G&A": 0
    },
    direct,
    burden
  });

  it("earns half of a started 50/50 work package and apportions from it", () => {
    const result = computeProjectEarnedValue(
      project(true),
      new Map([
        ["wp", totals(3000, 600, 30)],
        ["wp-task", totals(1000, 200, 10)]
      ]),
      "2026-10-31"
    );

    const wp = result.workPackages.find((p) => p.projectElementId === "wp");
    const qa = result.workPackages.find((p) => p.projectElementId === "qa");
    // Spec criterion "Earned value": BAC 10,000.00, started → BCWP 5,000.00.
    expect(wp).toMatchObject({
      controlAccountId: "ca",
      bac: 10000,
      bcws: 5000,
      bcwp: 5000,
      // ACWP is the direct cost of the subtree; burden stays out (C3).
      acwp: 4000,
      acwpHours: 40,
      baselineId: "pb1"
    });
    expect(wp?.acwpByElement.Overhead).toBe(800);
    expect(qa?.bcwp).toBe(500);
    // An element with a technique but no control account above it is not a
    // work package.
    expect(result.workPackages.map((p) => p.projectElementId)).toEqual([
      "wp",
      "qa"
    ]);
    expect(result.controlAccounts).toHaveLength(1);
    expect(result.controlAccounts[0]).toMatchObject({
      controlAccountId: "ca",
      readableId: "CA",
      bac: 11000,
      bcwp: 5500,
      acwp: 4000
    });
  });

  it("asks for a baseline when the project has work packages and none", () => {
    const result = computeProjectEarnedValue(
      project(false),
      undefined,
      "2026-10-31"
    );
    expect(result).toEqual({
      workPackages: [],
      controlAccounts: [],
      warnings: ["Take a baseline first"]
    });
  });
});
