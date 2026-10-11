// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";

const companyHasFeature = vi.hoisted(() => vi.fn());
vi.mock("../plan.server", () => ({ companyHasFeature }));

import { budgetOverrunMessage } from "./models";
import { checkBudgetAvailability } from "./service.server";

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
