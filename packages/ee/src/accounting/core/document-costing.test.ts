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
  company?: { baseCurrencyCode: string } | null;
  foreignCurrencyOnly?: boolean;
  currency?: { decimalPlaces: number } | null;
  purchaseInvoiceLine?: Array<{
    quantity: number;
    supplierUnitPrice: number;
    supplierShippingCost: number;
    supplierTaxAmount: number;
  }>;
  purchaseInvoiceDelivery?: { supplierShippingCost: number } | null;
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
    const filters: unknown[][] = [];
    const builder: any = {
      select: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: (...args: unknown[]) => {
        filters.push(args);
        return builder;
      },
      orderBy: () => builder,
      async execute() {
        if (table === "journalLine")
          return (
            tables.journalLine ?? [
              {
                id: "control",
                accountId: "ap",
                amount: 100,
                description: "Accounts Payable",
                documentLineReference: null,
                accountClass: "Liability"
              }
            ]
          );
        if (table === "journalLineDimension")
          return tables.journalLineDimension ?? [];
        if (table === "purchaseOrderLine")
          return tables.purchaseOrderLine ?? [];
        if (table === "purchaseInvoiceLine")
          return tables.purchaseInvoiceLine ?? [];
        return [];
      },
      async executeTakeFirst() {
        if (table === "purchaseInvoice")
          return tables.purchaseInvoice
            ? { ...tables.purchaseInvoice, postingDate: "2026-09-07" }
            : undefined;
        if (table === "company")
          return tables.company === null
            ? undefined
            : {
                companyGroupId: "group-1",
                ...(tables.company ?? { baseCurrencyCode: "USD" })
              };
        if (table === "currency" && tables.foreignCurrencyOnly)
          return filters.some(
            (filter) =>
              filter[0] === "companyGroupId" && filter[2] === "group-1"
          )
            ? undefined
            : { decimalPlaces: 3 };
        if (table === "currency")
          return tables.currency === null
            ? undefined
            : (tables.currency ?? { decimalPlaces: 2 });
        if (table === "purchaseInvoiceDelivery")
          return tables.purchaseInvoiceDelivery ?? undefined;
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
      billId: "pi_1"
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
      billId: "pi_1"
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
        },
        {
          id: "ap",
          accountId: "ap",
          amount: 100,
          description: "Accounts Payable",
          documentLineReference: null,
          accountClass: "Liability"
        }
      ],
      journalLineDimension: [
        { journalLineId: "jl-1", dimensionId: "dim_loc", valueId: "loc_hq" }
      ]
    });

    const result = await loadBillCostingLines(db, {
      companyId: "company-1",
      billId: "pi_1"
    });

    expect(result.lines[0]?.dimensions).toEqual([
      { dimensionId: "dim_loc", valueId: "loc_hq" }
    ]);
  });

  it("warns when the bill has no posted journal", async () => {
    await expect(
      loadBillCostingLines(
        makeDb({
          purchaseInvoice: { currencyCode: "EUR", exchangeRate: 1.1 },
          journalLine: []
        }),
        { companyId: "company-1", billId: "pi_1" }
      )
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
  });
});

describe("toTransactionCurrencyLines", () => {
  const line = (id: string, amount: number): CostingLine => ({
    id,
    accountId: `acct_${id}`,
    amount,
    description: id
  });
  it("multiplies base amounts by foreign per base rate", () => {
    expect(
      toTransactionCurrencyLines([line("a", 100)], {
        exchangeRate: 0.8,
        documentTotal: 80,
        decimalPlaces: 2
      })[0]?.amount
    ).toBe(80);
  });
  it("assigns rounding residual to the largest magnitude deterministically", () => {
    const result = toTransactionCurrencyLines([line("a", 100), line("b", 10)], {
      exchangeRate: 1 / 3,
      documentTotal: 36.67,
      decimalPlaces: 2
    });
    expect(result.map((l) => l.amount)).toEqual([33.34, 3.33]);
  });
  it("rounds identity rate and preserves labels, dimensions and negative variance", () => {
    const source = {
      ...line("a", 100.004),
      dimensions: [{ dimensionId: "d", valueId: "v" }]
    };
    expect(
      toTransactionCurrencyLines([source, line("ppv", -20.001)], {
        exchangeRate: 1,
        documentTotal: 80,
        decimalPlaces: 2
      })
    ).toEqual([{ ...source, amount: 100 }, line("ppv", -20)]);
  });
  it.each([
    [0, 80],
    [3, 80.003]
  ])("uses document scale %i", (decimalPlaces, total) => {
    expect(
      toTransactionCurrencyLines([line("a", total / 0.8)], {
        exchangeRate: 0.8,
        documentTotal: total,
        decimalPlaces
      })[0]?.amount
    ).toBe(total);
  });
  it("does not round the base sum to cents before conversion", () => {
    expect(
      toTransactionCurrencyLines([line("a", 0.005), line("b", 0.005)], {
        exchangeRate: 16000,
        documentTotal: 160,
        decimalPlaces: 2
      }).map((l) => l.amount)
    ).toEqual([80, 80]);
  });
  it("rejects an economic mismatch instead of hiding it in a residual", () => {
    expect(() =>
      toTransactionCurrencyLines([line("a", 100)], {
        exchangeRate: 0.8,
        documentTotal: 90,
        decimalPlaces: 2
      })
    ).toThrow(/total|reconcil/i);
  });
  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY
  ])("rejects invalid rate %s", (exchangeRate) => {
    expect(() =>
      toTransactionCurrencyLines([line("a", 100)], {
        exchangeRate,
        documentTotal: 80,
        decimalPlaces: 2
      })
    ).toThrow();
  });
  it("rejects nonfinite amounts and invalid precision", () => {
    expect(() =>
      toTransactionCurrencyLines([line("a", Infinity)], {
        exchangeRate: 1,
        documentTotal: 80,
        decimalPlaces: 2
      })
    ).toThrow();
    expect(() =>
      toTransactionCurrencyLines([line("a", 100)], {
        exchangeRate: 1,
        documentTotal: 100,
        decimalPlaces: -1
      })
    ).toThrow();
  });
  it("rejects an authoritative total outside its document precision", () => {
    expect(() =>
      toTransactionCurrencyLines([line("a", 80.003)], {
        exchangeRate: 1,
        documentTotal: 80.003,
        decimalPlaces: 2
      })
    ).toThrow(/precision/);
  });
  it("allows an empty zero document", () => {
    expect(
      toTransactionCurrencyLines([], {
        exchangeRate: 1,
        documentTotal: 0,
        decimalPlaces: 2
      })
    ).toEqual([]);
  });
});

describe("authoritative bill metadata", () => {
  it("loads supplier document totals once including delivery and line tax", async () => {
    const result = await loadBillCostingLines(
      makeDb({
        purchaseInvoice: { currencyCode: "EUR", exchangeRate: 0.8 },
        purchaseInvoiceLine: [
          {
            quantity: 2,
            supplierUnitPrice: 32,
            supplierShippingCost: 4,
            supplierTaxAmount: 8
          }
        ],
        purchaseInvoiceDelivery: { supplierShippingCost: 4 }
      }),
      { companyId: "company-1", billId: "pi-1" }
    );
    expect(result).toMatchObject({
      documentTotal: 80,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      exchangeRate: 0.8
    });
  });
  it.each([
    { purchaseInvoice: null },
    { company: null },
    { currency: null },
    { purchaseInvoice: { currencyCode: "USD", exchangeRate: 0.8 } }
  ])("rejects incomplete metadata: %j", async (overrides) => {
    await expect(
      loadBillCostingLines(
        makeDb({
          purchaseInvoice: { currencyCode: "EUR", exchangeRate: 0.8 },
          ...overrides
        }),
        { companyId: "company-1", billId: "pi-1" }
      )
    ).rejects.toThrow();
  });
});

it("does not borrow currency precision from another company group", async () => {
  await expect(
    loadBillCostingLines(
      makeDb({
        purchaseInvoice: { currencyCode: "EUR", exchangeRate: 0.8 },
        foreignCurrencyOnly: true
      }),
      { companyId: "company-1", billId: "pi-1" }
    )
  ).rejects.toThrow(/precision/);
});

describe("original bill control provenance", () => {
  it.each([
    "Accounts Payable",
    "IC Payables"
  ])("excludes original %s after a default change without dropping a costing row on the same account", async (description) => {
    const result = await loadBillCostingLines(
      makeDb({
        purchaseInvoice: { currencyCode: "EUR", exchangeRate: 1.1 },
        purchaseInvoiceLine: [
          {
            quantity: 1,
            supplierUnitPrice: 110,
            supplierShippingCost: 0,
            supplierTaxAmount: 0
          }
        ],
        journalLine: [
          {
            id: "cost",
            accountId: "old-ap",
            amount: -100,
            description: "Explicit account charge",
            documentLineReference: null,
            accountClass: "Liability"
          },
          {
            id: "ap",
            accountId: "old-ap",
            amount: 100,
            description,
            documentLineReference: null,
            accountClass: "Liability"
          }
        ]
      }),
      { companyId: "company-1", billId: "pi_1" }
    );
    expect(result.lines.map((line) => [line.id, line.amount])).toEqual([
      ["cost", 100]
    ]);
    expect(toTransactionCurrencyLines(result.lines, result)[0]?.amount).toBe(
      110
    );
  });
  it.each(
    [
      [],
      [
        {
          id: "cost",
          accountId: "expense",
          amount: 100,
          description: "Cost",
          documentLineReference: null,
          accountClass: "Expense"
        }
      ],
      [
        {
          id: "ap",
          accountId: null,
          amount: 100,
          description: "Accounts Payable",
          documentLineReference: null,
          accountClass: null
        }
      ]
    ].map((rows) => [rows])
  )("reports missing original posting metadata before numeric reconciliation", async (journalLine) => {
    await expect(
      loadBillCostingLines(
        makeDb({
          purchaseInvoice: { currencyCode: "USD", exchangeRate: 1 },
          journalLine
        }),
        { companyId: "company-1", billId: "pi_1" }
      )
    ).rejects.toMatchObject({
      failure: {
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        metadata: { billId: "pi_1" }
      }
    });
  });
});
