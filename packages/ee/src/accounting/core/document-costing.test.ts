import { describe, expect, it } from "vitest";
import {
  type CostingLine,
  loadBillCostingLines,
  toTransactionCurrencyLines
} from "./document-costing";

/**
 * Table-dispatching Kysely fake for loadBillCostingLines. Each configured
 * table resolves `execute()` / `executeTakeFirst()` to its rows; the chain
 * methods are no-ops that return the same builder.
 */
function makeDb(tables: {
  purchaseInvoice?: { currencyCode: string; exchangeRate: number } | null;
  journalLine?: Array<{
    id: string;
    accountId: string | null;
    amount: number;
    description: string | null;
    documentLineReference: string | null;
    accountClass: string | null;
  }>;
  journalLineDimension?: Array<{
    journalLineId: string;
    dimensionId: string;
    valueId: string;
  }>;
  purchaseOrderLine?: Array<{
    poLineId: string;
    itemId: string;
    code: string | null;
    name: string | null;
  }>;
}) {
  const makeBuilder = (table: string) => {
    const builder: any = {
      select: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      async execute() {
        if (table === "journalLine") return tables.journalLine ?? [];
        if (table === "journalLineDimension")
          return tables.journalLineDimension ?? [];
        if (table === "purchaseOrderLine")
          return tables.purchaseOrderLine ?? [];
        return [];
      },
      async executeTakeFirst() {
        if (table === "purchaseInvoice")
          return tables.purchaseInvoice ?? undefined;
        return undefined;
      }
    };
    return builder;
  };
  return { selectFrom: (t: string) => makeBuilder(t) } as never;
}

describe("loadBillCostingLines", () => {
  it("excludes the AP control line, base-currency debit-signed amounts", async () => {
    const db = makeDb({
      purchaseInvoice: { currencyCode: "USD", exchangeRate: 1 },
      journalLine: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300, // Asset/Expense: natural balance is debit
          description: "GR/IR Clearing",
          documentLineReference: null,
          accountClass: "Asset"
        },
        {
          id: "jl-2",
          accountId: "acct_ap",
          amount: 300, // Liability natural balance → debit-signed negates
          description: "Accounts Payable",
          documentLineReference: null,
          accountClass: "Liability"
        }
      ]
    });

    const result = await loadBillCostingLines(db, {
      companyId: "company-1",
      billId: "pi_1",
      payablesAccountId: "acct_ap"
    });

    expect(result.currencyCode).toBe("USD");
    expect(result.exchangeRate).toBe(1);
    expect(result.lines).toEqual([
      {
        id: "jl-1",
        accountId: "acct_grir",
        amount: 300,
        description: "GR/IR Clearing"
      }
    ]);
  });

  it("attaches sourceItem for PO-backed lines and leaves variance lines bare", async () => {
    const db = makeDb({
      purchaseInvoice: { currencyCode: "USD", exchangeRate: 1 },
      journalLine: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 280,
          description: "GR/IR Clearing",
          documentLineReference: "purchase-invoice:pol-1",
          accountClass: "Asset"
        },
        {
          id: "jl-2",
          accountId: "acct_ppv",
          amount: 20,
          description: "Purchase Price Variance",
          documentLineReference: null,
          accountClass: "Expense"
        },
        {
          id: "jl-3",
          accountId: "acct_ap",
          amount: 300,
          description: "Accounts Payable",
          documentLineReference: null,
          accountClass: "Liability"
        }
      ],
      purchaseOrderLine: [
        {
          poLineId: "pol-1",
          itemId: "item-1",
          code: "WIDGET-1",
          name: "Widget"
        }
      ]
    });

    const result = await loadBillCostingLines(db, {
      companyId: "company-1",
      billId: "pi_1",
      payablesAccountId: "acct_ap"
    });

    expect(result.lines).toEqual([
      {
        id: "jl-1",
        accountId: "acct_grir",
        amount: 280,
        description: "GR/IR Clearing",
        sourceItem: { id: "item-1", code: "WIDGET-1", name: "Widget" }
      },
      {
        id: "jl-2",
        accountId: "acct_ppv",
        amount: 20,
        description: "Purchase Price Variance"
      }
    ]);
  });

  it("carries journal line dimensions onto costing lines", async () => {
    const db = makeDb({
      purchaseInvoice: { currencyCode: "USD", exchangeRate: 1 },
      journalLine: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 100,
          description: "GR/IR",
          documentLineReference: null,
          accountClass: "Asset"
        }
      ],
      journalLineDimension: [
        { journalLineId: "jl-1", dimensionId: "dim_loc", valueId: "loc_hq" }
      ]
    });

    const result = await loadBillCostingLines(db, {
      companyId: "company-1",
      billId: "pi_1",
      payablesAccountId: "acct_ap"
    });

    expect(result.lines[0]?.dimensions).toEqual([
      { dimensionId: "dim_loc", valueId: "loc_hq" }
    ]);
  });

  it("returns no lines when the bill has no posted journal", async () => {
    const db = makeDb({
      purchaseInvoice: { currencyCode: "EUR", exchangeRate: 1.1 },
      journalLine: []
    });

    const result = await loadBillCostingLines(db, {
      companyId: "company-1",
      billId: "pi_1",
      payablesAccountId: "acct_ap"
    });

    expect(result.lines).toEqual([]);
    expect(result.currencyCode).toBe("EUR");
    expect(result.exchangeRate).toBe(1.1);
  });
});

describe("toTransactionCurrencyLines", () => {
  const line = (id: string, amount: number): CostingLine => ({
    id,
    accountId: `acct_${id}`,
    amount,
    description: id
  });

  it("passes through at rate 1", () => {
    const lines = [line("a", 280), line("b", 20)];
    expect(toTransactionCurrencyLines(lines, 1)).toEqual(lines);
  });

  it("divides by the rate and balances the residue into the largest line", () => {
    // base 100 @ rate 3 → 33.3333; base 10 @ rate 3 → 3.3333.
    // rounded: 33.33 + 3.33 = 36.66; target round(110/3)=36.67; residue +0.01
    // to the largest-|amount| line (a).
    const converted = toTransactionCurrencyLines(
      [line("a", 100), line("b", 10)],
      3
    );
    expect(converted.map((l) => l.amount)).toEqual([33.34, 3.33]);
    const sum = converted.reduce((s, l) => s + Math.round(l.amount * 100), 0);
    expect(sum).toBe(Math.round((110 / 3) * 100));
  });

  it("preserves negative (credit variance) amounts", () => {
    const converted = toTransactionCurrencyLines(
      [line("a", 300), line("ppv", -20)],
      2
    );
    expect(converted.map((l) => l.amount)).toEqual([150, -10]);
  });

  it("returns [] for empty input", () => {
    expect(toTransactionCurrencyLines([], 1.5)).toEqual([]);
  });
});
