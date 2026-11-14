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
  lineAccountChangePeriodRefusal
} from "./invoicing.service";

const SALES = "acc-4000";
const PARTS = "acc-4010";
const SERVICES = "acc-4020";
const RECEIVABLES = "acc-1200";
const TAX = "acc-2200";

const CLASSES: Record<string, InvoiceLineLeg["accountClass"]> = {
  [SALES]: "Revenue",
  [PARTS]: "Revenue",
  [SERVICES]: "Revenue",
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

/** A posted sales line: revenue (credit), tax (credit) and AR (debit). */
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

/** Debit-signed balance per account. */
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

/** Applies a change: the lines it writes, as legs the next change reads. */
const apply = (
  legs: InvoiceLineLeg[],
  target: Parameters<typeof findInvoiceLinePosition>[1],
  toAccountId: string
) => {
  const position = findInvoiceLinePosition(legs, target);
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
    expect(findInvoiceLinePosition(first.legs, salesTarget(SALES, 100))).toBe(
      null
    );
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
    // The other line is still on the Sales account.
    expect(
      findInvoiceLinePosition(
        legs,
        salesTarget(SALES, 100, { dimensions: { Location: "loc-a" } })
      )?.leg.journalLineReference
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
    ).toBe(null);
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
