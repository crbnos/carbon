// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { debitSigned } from "@carbon/database/ledger";
import { describe, expect, it } from "vitest";
import {
  buildLineAccountChangeLines,
  findInvoiceLinePosition,
  type InvoiceLineLeg,
  LINE_ACCOUNT_CHANGE_PREFIX,
  lineAccountChangePeriodRefusal,
  lineAccountChangeTargetRefusal,
  locateInvoiceLinePosition
} from "./invoicing.service";

const SALES = "acc-4000";
const PARTS = "acc-4010";
const SERVICES = "acc-4020";
const SHIPPING = "acc-4050";
const RECEIVABLES = "acc-1200";
const TAX = "acc-2200";

const CLASSES: Record<string, InvoiceLineLeg["accountClass"]> = {
  [SALES]: "Revenue",
  [PARTS]: "Revenue",
  [SERVICES]: "Revenue",
  [SHIPPING]: "Revenue",
  [RECEIVABLES]: "Asset",
  [TAX]: "Liability",
  "acc-6000": "Expense",
  "acc-6100": "Expense",
  "acc-2000": "Liability"
};

let nextId = 0;
const leg = (
  accountId: string,
  amount: number,
  extra: Partial<InvoiceLineLeg> = {}
): InvoiceLineLeg => ({
  id: `jl-${String(++nextId).padStart(3, "0")}`,
  accountId,
  accountClass: CLASSES[accountId] ?? null,
  amount,
  quantity: 1,
  description: "Sales Account",
  documentType: "Invoice",
  documentId: "inv-1",
  externalDocumentId: null,
  documentLineReference: null,
  journalLineReference: "ref-1",
  accountDefaultRole: null,
  postingDate: "2026-03-14",
  dimensions: {},
  ...extra
});

const salesLine = (
  reference: string,
  revenue: number,
  extra: Partial<InvoiceLineLeg> = {}
) => [
  leg(SALES, revenue, { journalLineReference: reference, ...extra }),
  leg(TAX, round2(revenue * 0.1), {
    journalLineReference: reference,
    description: "Sales Tax Payable",
    ...extra
  }),
  leg(RECEIVABLES, round2(revenue * 1.1), {
    journalLineReference: reference,
    description: "Accounts Receivable",
    ...extra
  })
];

const round2 = (value: number) => Math.round(value * 100) / 100;

const balances = (legs: { accountId?: string | null; amount?: number }[]) => {
  const out: Record<string, number> = {};
  for (const row of legs) {
    const accountClass = CLASSES[row.accountId ?? ""];
    if (!accountClass) throw new Error(`No class for ${row.accountId}`);
    out[row.accountId!] = round2(
      (out[row.accountId!] ?? 0) + debitSigned(accountClass, row.amount ?? 0)
    );
  }
  return out;
};

const apply = (
  legs: InvoiceLineLeg[],
  target: Parameters<typeof findInvoiceLinePosition>[1],
  toAccountId: string
) => {
  const { position } = findInvoiceLinePosition(legs, target);
  if (!position) throw new Error("No position");
  const lines = buildLineAccountChangeLines(
    position,
    { accountId: toAccountId, accountClass: CLASSES[toAccountId]! },
    "company-1"
  );
  return {
    position,
    lines,
    legs: [
      ...legs,
      ...lines.map((line) =>
        leg(line.accountId!, line.amount, {
          quantity: line.quantity ?? 0,
          description: line.description ?? null,
          journalLineReference: line.journalLineReference,
          documentLineReference: line.documentLineReference ?? null,
          postingDate: position.postingDate,
          dimensions: position.leg.dimensions
        })
      )
    ]
  };
};

const missing = { position: null, refusal: "missing" };

const salesTarget = (accountId: string, amount: number, extra = {}) => ({
  accountId,
  quantity: 1,
  documentLineReference: null,
  // A revenue credit, debit-signed.
  amount: -amount,
  dimensions: {},
  ...extra
});

describe("changing a posted line's account", () => {
  it("moves the line's revenue and nothing else, in a balanced journal", () => {
    const posted = [...salesLine("ref-1", 100), ...salesLine("ref-2", 40)];
    const before = balances(posted);
    expect(before).toEqual({
      [SALES]: -140,
      [TAX]: -14,
      [RECEIVABLES]: 154
    });

    const { lines, legs } = apply(posted, salesTarget(SALES, 100), PARTS);

    // Debits equal credits.
    expect(
      round2(
        lines.reduce(
          (sum, line) =>
            sum + debitSigned(CLASSES[line.accountId!]!, line.amount),
          0
        )
      )
    ).toBe(0);
    expect(lines.map((line) => line.description)).toEqual([
      `${LINE_ACCOUNT_CHANGE_PREFIX}Sales Account`,
      `${LINE_ACCOUNT_CHANGE_PREFIX}Sales Account`
    ]);
    // The keys a void reverses by.
    expect(lines.every((line) => line.documentId === "inv-1")).toBe(true);
    expect(lines.every((line) => line.journalLineReference === "ref-1")).toBe(
      true
    );

    expect(balances(legs)).toEqual({
      [SALES]: -40,
      [PARTS]: -100,
      [TAX]: -14,
      [RECEIVABLES]: 154
    });
  });

  it("finds the amount on the account an earlier change moved it to", () => {
    const posted = salesLine("ref-1", 100);
    const first = apply(posted, salesTarget(SALES, 100), PARTS);
    // The posting's own leg no longer holds anything on the Sales account.
    expect(
      findInvoiceLinePosition(first.legs, salesTarget(SALES, 100))
    ).toEqual(missing);
    const second = apply(first.legs, salesTarget(PARTS, 100), SERVICES);
    expect(second.position.postingDate).toBe("2026-03-14");
    expect(balances(second.legs)).toEqual({
      [SALES]: 0,
      [PARTS]: 0,
      [SERVICES]: -100,
      [TAX]: -10,
      [RECEIVABLES]: 110
    });
  });

  it("tells two lines on one account apart by their amount", () => {
    const posted = [...salesLine("ref-1", 100), ...salesLine("ref-2", 40)];
    const { position } = apply(posted, salesTarget(SALES, 40), PARTS);
    expect(position.leg.journalLineReference).toBe("ref-2");
    expect(position.amount).toBe(-40);
  });

  it("tells two lines of one amount apart by their dimensions", () => {
    const posted = [
      ...salesLine("ref-1", 100, { dimensions: { Location: "loc-a" } }),
      ...salesLine("ref-2", 100, { dimensions: { Location: "loc-b" } })
    ];
    const { position, legs } = apply(
      posted,
      salesTarget(SALES, 100, { dimensions: { Location: "loc-b" } }),
      PARTS
    );
    expect(position.leg.journalLineReference).toBe("ref-2");
    expect(
      findInvoiceLinePosition(
        legs,
        salesTarget(SALES, 100, { dimensions: { Location: "loc-a" } })
      ).position?.leg.journalLineReference
    ).toBe("ref-1");
  });

  it("moves a G/L Account line's cost between expense accounts", () => {
    const posted = [
      leg("acc-6000", 250, { description: "Office Supplies" }),
      leg("acc-2000", 250, { description: "Accounts Payable" })
    ];
    const { legs } = apply(
      posted,
      {
        accountId: "acc-6000",
        quantity: 1,
        documentLineReference: null,
        amount: 250,
        dimensions: {}
      },
      "acc-6100"
    );
    expect(balances(legs)).toEqual({
      "acc-6000": 0,
      "acc-6100": 250,
      "acc-2000": -250
    });
  });

  it("finds nothing on an account the line was never posted to", () => {
    expect(
      findInvoiceLinePosition(salesLine("ref-1", 100), salesTarget(PARTS, 100))
    ).toEqual(missing);
  });
});

describe("the account a line's amount is on now", () => {
  const { accountId: _, ...target } = salesTarget(SALES, 100);

  it("ignores a sales line's account its posting never used", () => {
    // Convert copies the order line's account onto the invoice line; sales
    // posting credits the Sales Account regardless.
    const { position } = locateInvoiceLinePosition(
      salesLine("ref-1", 100),
      "sales",
      [PARTS],
      target
    );
    expect(position?.leg.accountId).toBe(SALES);
    expect(position?.amount).toBe(-100);
  });

  it("finds a sales line with no account of its own on the Sales Account", () => {
    expect(
      locateInvoiceLinePosition(salesLine("ref-1", 100), "sales", [], target)
        .position?.leg.accountId
    ).toBe(SALES);
  });

  it("finds the account an earlier change moved the line to", () => {
    const { legs } = apply(
      salesLine("ref-1", 100),
      salesTarget(SALES, 100),
      PARTS
    );
    expect(
      locateInvoiceLinePosition(legs, "sales", [PARTS], target).position?.leg
        .accountId
    ).toBe(PARTS);
  });

  it("looks only at a purchase line's own account", () => {
    const posted = [
      leg("acc-6000", 250, { description: "Office Supplies" }),
      leg("acc-2000", 250, { description: "Accounts Payable" })
    ];
    const purchase = {
      quantity: 1,
      documentLineReference: null,
      amount: 250,
      dimensions: {}
    };
    expect(
      locateInvoiceLinePosition(posted, "purchase", ["acc-6000"], purchase)
        .position?.leg.accountId
    ).toBe("acc-6000");
    expect(
      locateInvoiceLinePosition(posted, "purchase", ["acc-6100"], purchase)
    ).toEqual(missing);
  });
});

describe("a group that is not the line's", () => {
  const { accountId: _, ...targetA } = salesTarget(SALES, 100);

  it("refuses rather than take another line's amount when the line's own group holds more", () => {
    // Line A posts 100 to Sales and 10 to Shipping, line B 40 to Sales.
    const posted = [
      ...salesLine("ref-a", 100),
      leg(SHIPPING, 10, {
        journalLineReference: "ref-a",
        description: "Shipping Revenue"
      }),
      ...salesLine("ref-b", 40)
    ];
    // A's revenue on its own shipping account, a move the change now refuses:
    // A's group holds 110 there.
    const { legs } = apply(posted, salesTarget(SALES, 100), SHIPPING);
    // Sales then holds only B's 40, which is not A's amount.
    expect(
      locateInvoiceLinePosition(legs, "sales", [SHIPPING], targetA)
    ).toEqual(missing);
  });

  it("refuses a sole group posted with another line's dimensions", () => {
    const posted = salesLine("ref-b", 100, {
      dimensions: { Location: "loc-b" }
    });
    expect(
      findInvoiceLinePosition(
        posted,
        salesTarget(SALES, 100, { dimensions: { Location: "loc-a" } })
      )
    ).toEqual(missing);
  });

  it("refuses a sole group of another amount", () => {
    expect(
      findInvoiceLinePosition(salesLine("ref-b", 40), salesTarget(SALES, 100))
    ).toEqual(missing);
  });

  it("refuses two groups it cannot tell apart", () => {
    const posted = [...salesLine("ref-1", 100), ...salesLine("ref-2", 100)];
    expect(locateInvoiceLinePosition(posted, "sales", [], targetA)).toEqual({
      position: null,
      refusal: "ambiguous"
    });
  });
});

describe("a new account another leg of the line holds", () => {
  // The line posts 100 to Sales and 10 to Shipping.
  const posted = [
    ...salesLine("ref-a", 100),
    leg(SHIPPING, 10, {
      journalLineReference: "ref-a",
      description: "Shipping Revenue"
    })
  ];
  const account = (id: string) => ({ id, number: "4050", name: "Shipping" });

  it("refuses the line's own shipping account, naming it", () => {
    const { position } = findInvoiceLinePosition(
      posted,
      salesTarget(SALES, 100)
    );
    expect(
      lineAccountChangeTargetRefusal(position!, account(SHIPPING))
    ).toContain("4050 Shipping");
    expect(
      lineAccountChangeTargetRefusal(position!, account(PARTS))
    ).toBeNull();
  });

  it("accepts an account the line left again, which now holds nothing of it", () => {
    const there = apply(posted, salesTarget(SALES, 100), PARTS);
    const back = apply(there.legs, salesTarget(PARTS, 100), SALES);
    const { position } = findInvoiceLinePosition(
      back.legs,
      salesTarget(SALES, 100)
    );
    expect(
      lineAccountChangeTargetRefusal(position!, account(PARTS))
    ).toBeNull();
    expect(
      lineAccountChangeTargetRefusal(position!, account(SHIPPING))
    ).not.toBeNull();
  });
});

describe("the original posting's period", () => {
  const period = {
    fiscalYear: 2026,
    periodNumber: 3,
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    closedAt: null
  };

  it("refuses a closed period, naming it", () => {
    expect(
      lineAccountChangePeriodRefusal({ ...period, closeStatus: "Closed" })
    ).toBe(
      "Accounting period FY2026 · Period 3 is closed. Reopen it before changing the account."
    );
  });

  it("refuses a locked period, naming it", () => {
    expect(
      lineAccountChangePeriodRefusal({ ...period, closeStatus: "Locked" })
    ).toBe(
      "Accounting period FY2026 · Period 3 is locked. Unlock it before changing the account."
    );
  });

  it("names a period with no fiscal numbering by its dates", () => {
    expect(
      lineAccountChangePeriodRefusal({
        ...period,
        fiscalYear: null,
        periodNumber: null,
        closeStatus: "Closed"
      })
    ).toContain("2026-03-01 to 2026-03-31");
  });

  it("accepts an open period", () => {
    expect(
      lineAccountChangePeriodRefusal({ ...period, closeStatus: "Open" })
    ).toBe(null);
  });
});
