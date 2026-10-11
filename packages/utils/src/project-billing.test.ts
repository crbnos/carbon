// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  BILLABLE_REASON_NO_BILL_RATE,
  BILLABLE_REASON_NO_HOURS,
  estimateAtCompletion,
  fundingNotice,
  PROJECT_HOLD_CREDIT,
  planProjectInvoiceLines,
  priceTimeAndMaterialsItem,
  projectInvoiceHold,
  resolveBillRate,
  selectRowsToBill,
  sumSubtree,
  takeWithinFunding
} from "./project-billing";

const ENGINEER = "lc-engineer-2";
const EMPLOYEE = "user-ada";

const categoryRates = [
  { laborCategoryId: ENGINEER, billRate: 150, effectiveFrom: "2026-01-01" }
];

const rateFor = (
  contractRates: Parameters<typeof resolveBillRate>[0]["contractRates"]
) =>
  resolveBillRate({
    date: "2026-10-05",
    employeeId: EMPLOYEE,
    laborCategoryId: ENGINEER,
    contractRates,
    categoryRates
  });

const labor = (rate: number | null) =>
  priceTimeAndMaterialsItem({
    costType: "Labor",
    cost: 480,
    hours: 6,
    rate,
    materialHandlingPercent: 0.1
  });

describe("resolveBillRate and priceTimeAndMaterialsItem", () => {
  it("bills 6 h at the Engineer II default of 150.00 as 900.00", () => {
    const item = labor(rateFor([]));
    expect(item).toEqual({
      quantity: 6,
      unitPrice: 150,
      amount: 900,
      status: "Unbilled",
      statusReason: null
    });
  });

  it("uses a contract rate for the labor category: 960.00", () => {
    const rate = rateFor([
      {
        employeeId: null,
        laborCategoryId: ENGINEER,
        billRate: 160,
        effectiveFrom: "2026-09-01"
      }
    ]);
    expect(labor(rate)?.amount).toBe(960);
  });

  it("uses a contract rate for the employee before the category: 1,050.00", () => {
    const rate = rateFor([
      {
        employeeId: null,
        laborCategoryId: ENGINEER,
        billRate: 160,
        effectiveFrom: "2026-09-01"
      },
      {
        employeeId: EMPLOYEE,
        laborCategoryId: null,
        billRate: 175,
        effectiveFrom: "2026-09-01"
      },
      {
        employeeId: EMPLOYEE,
        laborCategoryId: null,
        billRate: 999,
        effectiveFrom: "2026-11-01"
      }
    ]);
    expect(labor(rate)?.amount).toBe(1050);
  });

  it("holds a labor row with no rate anywhere", () => {
    const rate = resolveBillRate({
      date: "2026-10-05",
      employeeId: EMPLOYEE,
      laborCategoryId: ENGINEER,
      contractRates: [],
      categoryRates: [
        {
          laborCategoryId: ENGINEER,
          billRate: null,
          effectiveFrom: "2026-01-01"
        }
      ]
    });
    expect(rate).toBeNull();
    expect(labor(rate)).toMatchObject({
      status: "On Hold",
      statusReason: BILLABLE_REASON_NO_BILL_RATE,
      amount: 0
    });
  });

  it("holds a labor row with no hours", () => {
    const item = priceTimeAndMaterialsItem({
      costType: "Labor",
      cost: 100,
      hours: null,
      rate: 150,
      materialHandlingPercent: null
    });
    expect(item).toMatchObject({
      status: "On Hold",
      statusReason: BILLABLE_REASON_NO_HOURS
    });
  });

  it("bills a 200.00 material issue at handling 10 % as 220.00", () => {
    const item = priceTimeAndMaterialsItem({
      costType: "Material",
      cost: 200,
      hours: null,
      rate: null,
      materialHandlingPercent: 0.1
    });
    expect(item).toMatchObject({ quantity: 1, unitPrice: 220, amount: 220 });
  });

  it("does not bill an overhead row", () => {
    expect(
      priceTimeAndMaterialsItem({
        costType: "Overhead",
        cost: 500,
        hours: null,
        rate: null,
        materialHandlingPercent: 0.1
      })
    ).toBeNull();
  });
});

describe("takeWithinFunding", () => {
  it("takes 6,000.00 and holds 5,000.00 against funded 10,000.00", () => {
    const items = [
      { id: "a", amount: 6000, postingDate: "2026-10-01" },
      { id: "b", amount: 5000, postingDate: "2026-10-02" }
    ];
    const { take, held } = takeWithinFunding(items, {
      billed: 0,
      fundedAmount: 10000
    });
    expect(take.map((i) => i.id)).toEqual(["a"]);
    expect(held.map((i) => i.id)).toEqual(["b"]);
  });

  it("takes every item with no funded amount", () => {
    const { take } = takeWithinFunding([{ amount: 1 }, { amount: 2 }], {
      billed: 0,
      fundedAmount: null
    });
    expect(take).toHaveLength(2);
  });
});

describe("fundingNotice", () => {
  const base = {
    asOf: "2026-10-31",
    incurred: 60000,
    recentCost: 27000,
    remainingPlan: null,
    fundedCost: 100000,
    noticePercent: 0.75,
    noticeWindowDays: 60,
    thresholdNoticeFundedCost: null,
    runOutNoticeFundedCost: null
  };

  it("expects 18,000.00 and is due at 78,000.00 against 75,000.00", () => {
    const notice = fundingNotice(base);
    expect(notice.expected).toBe(18000);
    expect(notice.threshold).toBe(true);
    // 40,000.00 left at 300.00 a day: 134 days, outside the 60-day window.
    expect(notice.runOutDate).toBe("2027-03-14");
    expect(notice.runOut).toBe(false);
  });

  it("is not due again for the funded cost it went out for", () => {
    expect(
      fundingNotice({ ...base, thresholdNoticeFundedCost: 100000 }).threshold
    ).toBe(false);
  });

  it("caps the expected cost at the plan's remaining cost", () => {
    expect(fundingNotice({ ...base, remainingPlan: 5000 }).expected).toBe(5000);
  });
});

describe("planProjectInvoiceLines", () => {
  it("groups Engineer II labor by unit price", () => {
    const item = (id: string, hours: number, unitPrice: number) => ({
      id,
      costType: "Labor" as const,
      laborCategoryId: ENGINEER,
      laborCategoryName: "Engineer II",
      quantity: hours,
      unitPrice,
      amount: hours * unitPrice,
      billingMethod: "Time & Materials" as const
    });
    const lines = planProjectInvoiceLines([
      item("a", 6, 150),
      item("b", 2, 160),
      item("c", 4, 150),
      {
        id: "m",
        costType: "Material",
        laborCategoryId: null,
        laborCategoryName: null,
        quantity: 1,
        unitPrice: 220,
        amount: 220,
        billingMethod: "Time & Materials"
      }
    ]);
    expect(lines).toEqual([
      {
        description: "Engineer II",
        quantity: 10,
        unitPrice: 150,
        itemIds: ["a", "c"]
      },
      {
        description: "Engineer II",
        quantity: 2,
        unitPrice: 160,
        itemIds: ["b"]
      },
      { description: "Material", quantity: 1, unitPrice: 220, itemIds: ["m"] }
    ]);
  });
});

describe("projectInvoiceHold", () => {
  it("holds a credit, and a re-bill before a credit", () => {
    expect(
      projectInvoiceHold("Draft Only", [
        { amount: -1, voidedInvoiceReadableId: null }
      ])
    ).toBeNull();
    expect(
      projectInvoiceHold("Post", [
        { amount: -1, voidedInvoiceReadableId: null }
      ])
    ).toBe(PROJECT_HOLD_CREDIT);
    expect(
      projectInvoiceHold("Post", [
        { amount: -1, voidedInvoiceReadableId: null },
        { amount: 5, voidedInvoiceReadableId: "INV-7" }
      ])
    ).toContain("INV-7");
  });
});

describe("selectRowsToBill", () => {
  it("skips a row that has an item", () => {
    const rows = [
      { id: "r1", reversalOfId: null },
      { id: "r2", reversalOfId: null }
    ];
    expect(selectRowsToBill(rows, new Set(["r1"])).map((r) => r.id)).toEqual([
      "r2"
    ]);
  });

  it("skips a reversal whose original has an item", () => {
    const rows = [
      { id: "r1", reversalOfId: null },
      { id: "r1x", reversalOfId: "r1" }
    ];
    expect(selectRowsToBill(rows, new Set(["r1"]))).toEqual([]);
  });

  it("skips an original and its reversal when neither has an item", () => {
    const rows = [
      { id: "r1", reversalOfId: null },
      { id: "r1x", reversalOfId: "r1" },
      { id: "r2", reversalOfId: null }
    ];
    expect(selectRowsToBill(rows, new Set()).map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("estimateAtCompletion and sumSubtree", () => {
  it("sums a subtree and estimates it", () => {
    const elements = [
      { id: "root", parentId: null },
      { id: "child", parentId: "root" },
      { id: "other", parentId: null }
    ];
    const row = (projectElementId: string, actual: number) => ({
      projectElementId,
      planMaterial: 100,
      planLabor: 0,
      planOther: 0,
      committed: 10,
      actual
    });
    const total = sumSubtree(
      [row("root", 20), row("child", 30), row("other", 999)],
      elements,
      "root"
    );
    expect(total).toEqual({ plan: 200, committed: 20, actual: 50 });
    expect(estimateAtCompletion(total)).toBe(200);
    expect(estimateAtCompletion({ ...total, override: 500 })).toBe(500);
  });
});
