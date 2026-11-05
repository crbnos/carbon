// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  allocateRecoverableTax,
  type BillTaxLedgerRow,
  type BillTaxLine,
  billSendsTax,
  type CostingLine,
  loadBillCostingLines,
  planBillTaxLines,
  resolveCostingLineTax,
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
        description: "GR/IR Clearing",
        tax: null
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
        sourceItem: { id: "item-1", code: "WIDGET-1", name: "Widget" },
        tax: null
      },
      {
        id: "jl-2",
        accountId: "acct_ppv",
        amount: 20,
        description: "Purchase Price Variance",
        tax: null
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
      failure: {
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        // Both causes: a bill dated before the cutover never gets a Posted
        // journal, so "post it" alone would stay wrong after setup.
        message: expect.stringMatching(
          /not posted yet.*dated before your accounting cutover/
        )
      }
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
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid rate %s",
    (exchangeRate) => {
      expect(() =>
        toTransactionCurrencyLines([line("a", 100)], {
          exchangeRate,
          documentTotal: 80,
          decimalPlaces: 2
        })
      ).toThrow();
    }
  );
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
  it.each(["Accounts Payable", "IC Payables"])(
    "excludes original %s after a default change without dropping a costing row on the same account",
    async (description) => {
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
    }
  );
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
  )(
    "reports missing original posting metadata before numeric reconciliation",
    async (journalLine) => {
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
    }
  );
});

describe("bill tax", () => {
  it("still refuses a cost gap once the tax legs are set aside", () => {
    expect(() =>
      toTransactionCurrencyLines(
        [{ id: "cost", accountId: "x", amount: 990, description: null }],
        {
          exchangeRate: 1,
          documentTotal: 1200,
          decimalPlaces: 2,
          taxLegs: [
            { id: "tax", accountId: "t", amount: 200, description: null }
          ]
        }
      )
    ).toThrow(/does not reconcile/);
  });

  it("flags the Tax Paid and Reverse Charge Tax legs by their posting role", async () => {
    const result = await loadBillCostingLines(
      makeDb({
        purchaseInvoice: { currencyCode: "USD", exchangeRate: 1 },
        purchaseInvoiceLine: [
          {
            quantity: 1,
            supplierUnitPrice: 1000,
            supplierShippingCost: 0,
            supplierTaxAmount: 0
          }
        ],
        journalLine: [
          {
            id: "cost",
            accountId: "grir",
            amount: 1000,
            description: "GR/IR Clearing",
            documentLineReference: null,
            accountClass: "Asset"
          },
          {
            id: "paid",
            accountId: "tax-paid",
            amount: 200,
            description: "Tax Paid",
            documentLineReference: null,
            accountClass: "Asset"
          },
          {
            id: "rc",
            accountId: "rc",
            amount: 200,
            description: "Reverse Charge Tax",
            documentLineReference: null,
            accountClass: "Liability"
          },
          {
            id: "ap",
            accountId: "ap",
            amount: 1000,
            description: "Accounts Payable",
            documentLineReference: null,
            accountClass: "Liability"
          }
        ]
      }),
      { companyId: "company-1", billId: "pi_1" }
    );
    expect(
      result.lines.map((line) => [
        line.id,
        line.amount,
        line.taxLeg ?? false,
        line.reverseChargeLeg ?? false
      ])
    ).toEqual([
      ["cost", 1000, false, false],
      ["paid", 200, true, false],
      ["rc", -200, false, true]
    ]);
    expect(billSendsTax(result.lines)).toBe(false);
  });

  const lines = [
    {
      id: "po-line",
      purchaseOrderLineId: "po-1",
      accountId: null,
      taxCodeId: "uk20",
      taxPercent: 0.2
    },
    {
      id: "gl-line",
      purchaseOrderLineId: null,
      accountId: "travel",
      taxCodeId: "exempt",
      taxPercent: 0
    }
  ];
  const taxOf = resolveCostingLineTax(lines);

  it("ties a PO-backed leg to its purchase-order line's tax", () => {
    expect(taxOf({ purchaseOrderLineId: "po-1", accountId: "grni" })).toEqual({
      taxCodeId: "uk20",
      taxPercent: 0.2
    });
  });

  it("ties a direct leg to the direct line on its account", () => {
    expect(
      taxOf({ purchaseOrderLineId: null, accountId: "travel" })
    ).toMatchObject({ taxCodeId: "exempt", taxPercent: 0 });
  });

  it("leaves a leg it cannot tie to one tax unresolved", () => {
    expect(taxOf({ purchaseOrderLineId: null, accountId: "other" })).toBeNull();
    const conflicting = resolveCostingLineTax([
      { ...lines[1]!, id: "a" },
      { ...lines[1]!, id: "b", taxCodeId: "uk20", taxPercent: 0.2 }
    ]);
    expect(
      conflicting({ purchaseOrderLineId: null, accountId: "travel" })
    ).toBeNull();
  });

  it("gives every leg the bill's one tax when all lines share it", () => {
    const one = resolveCostingLineTax([lines[0]!]);
    expect(
      one({ purchaseOrderLineId: null, accountId: "variance" })
    ).toMatchObject({ taxCodeId: "uk20", taxPercent: 0.2 });
  });
});

/**
 * `planBillTaxLines`: the recoverable tax of each code comes from the tax
 * ledger, never from a leg's amount, which also holds the non-recoverable
 * tax and the leg's share of the untaxed header freight.
 */
describe("planBillTaxLines", () => {
  const document = { id: "pi_1", label: "bill PI-1" };
  const leg = (
    id: string,
    amount: number,
    tax: CostingLine["tax"] = { taxCodeId: "uk20", taxPercent: 0.2 }
  ): CostingLine => ({
    id,
    accountId: `acct-${id}`,
    amount,
    description: id,
    tax
  });
  const taxPaid = (id: string, amount: number): CostingLine => ({
    id,
    accountId: "tax-paid",
    amount,
    description: "Tax Paid",
    taxLeg: true,
    tax: null
  });
  const ledger = (
    taxCodeId: string | null,
    taxPercent: number,
    taxAmount: number,
    recoverableAmount: number
  ): BillTaxLedgerRow => ({
    documentLineId: "pil-1",
    taxCodeId,
    taxCodeComponentId: null,
    taxPercent,
    taxableAmount: 0,
    taxAmount,
    recoverableAmount
  });
  const plan = (
    legs: CostingLine[],
    taxLedger: BillTaxLedgerRow[],
    documentTotal: number,
    exchangeRate = 1
  ) =>
    planBillTaxLines(
      { lines: legs, taxLedger, exchangeRate, documentTotal, decimalPlaces: 2 },
      document
    );
  const summary = (lines: BillTaxLine[]) =>
    lines.map((line) => [
      line.leg.id,
      line.amount,
      line.tax?.taxCodeId ?? null,
      line.tax?.taxAmount ?? null
    ]);
  const total = (result: ReturnType<typeof plan>) =>
    result.lines.reduce(
      (sum, line) => sum + line.amount + (line.tax?.taxAmount ?? 0),
      0
    );

  it("taxes the net and leaves the header freight untaxed on a fully recoverable bill", () => {
    // £1,000 at 20%, all recoverable, plus £50 of untaxed header freight.
    const result = plan(
      [leg("cost", 1050), taxPaid("paid", 200)],
      [ledger("uk20", 0.2, 200, 200)],
      1250
    );
    expect(result.sendsTax).toBe(true);
    expect(result.recoverableTax).toBe(200);
    expect(summary(result.lines)).toEqual([
      ["cost", 1000, "uk20", 200],
      ["cost", 50, null, null]
    ]);
    expect(total(result)).toBeCloseTo(1250, 6);
  });

  it("never rounds a share that does not terminate (GST 5% recoverable of 12%, $29,900.05)", () => {
    const result = plan(
      [
        leg("cost", 31993.05583, { taxCodeId: "bc12", taxPercent: 0.12 }),
        taxPaid("paid", 1495.00417)
      ],
      [
        ledger("bc12", 0.05, 1495.00417, 1495.00417),
        ledger("bc12", 0.07, 2093.00583, 0)
      ],
      33488.06
    );
    expect(summary(result.lines)).toEqual([
      ["cost", 12458.33, "bc12", 1495],
      ["cost", 19534.73, null, null]
    ]);
    expect(total(result)).toBeCloseTo(33488.06, 6);
  });

  it("taxes only the recoverable net of a 50% recoverable bill", () => {
    // £1,000 at 20%, half recoverable, £50 freight: cost 1,150, Tax Paid 100.
    const result = plan(
      [leg("cost", 1150), taxPaid("paid", 100)],
      [ledger("uk20", 0.2, 200, 100)],
      1250
    );
    expect(summary(result.lines)).toEqual([
      ["cost", 500, "uk20", 100],
      ["cost", 650, null, null]
    ]);
  });

  it("places each code's tax on its own legs on a bill spanning two codes", () => {
    const result = plan(
      [
        leg("a", 1051.85185),
        taxPaid("paid-a", 200),
        leg("b", 418.14815, { taxCodeId: "uk5", taxPercent: 0.05 }),
        taxPaid("paid-b", 20)
      ],
      [ledger("uk20", 0.2, 200, 200), ledger("uk5", 0.05, 20, 20)],
      1690
    );
    expect(summary(result.lines)).toEqual([
      ["a", 1000, "uk20", 200],
      ["a", 51.85, null, null],
      ["b", 400, "uk5", 20],
      ["b", 18.15, null, null]
    ]);
    expect(result.recoverableTax).toBe(220);
  });

  it("fills a code's largest legs first, never past a leg's own amount", () => {
    // 1,000 of net at 20% across a 700 leg and a 400 leg; a credit variance
    // takes none of it.
    const result = plan(
      [
        leg("small", 400),
        leg("large", 700),
        leg("ppv", -50),
        taxPaid("paid", 200)
      ],
      [ledger("uk20", 0.2, 200, 200)],
      1250
    );
    expect(summary(result.lines)).toEqual([
      ["small", 300, "uk20", 60],
      ["small", 100, null, null],
      ["large", 700, "uk20", 140],
      ["ppv", -50, null, null]
    ]);
  });

  it("converts the Tax Paid legs once as a total, so many legs of one code still reconcile", () => {
    // Ten lines of 10.00 tax at 12%, GST 5/12 recoverable: each Tax Paid leg
    // is 4.16667. Rounded leg by leg they sum to 41.70; the posting is 41.67.
    const legs = Array.from({ length: 10 }, (_, index) =>
      leg(`cost-${index}`, 89.16667, { taxCodeId: "bc12", taxPercent: 0.12 })
    );
    const result = plan(
      [...legs, ...legs.map((_, index) => taxPaid(`paid-${index}`, 4.16667))],
      legs.map(() => ledger("bc12", 0.05, 4.16667, 4.16667)),
      933.33
    );
    expect(result.recoverableTax).toBe(41.67);
    expect(
      result.lines.reduce((sum, line) => sum + (line.tax?.taxAmount ?? 0), 0)
    ).toBeCloseTo(41.67, 6);
    expect(total(result)).toBeCloseTo(933.33, 6);
  });

  it("sends a reverse-charge bill tax-neutral, its Tax Paid and reverse-charge legs included", () => {
    const legs: CostingLine[] = [
      leg("cost", 1000),
      taxPaid("paid", 200),
      {
        id: "rc",
        accountId: "rc",
        amount: -200,
        description: "Reverse Charge Tax",
        reverseChargeLeg: true,
        tax: null
      }
    ];
    const result = plan(legs, [ledger("uk20", 0.2, 200, 200)], 1000);
    expect(result.sendsTax).toBe(false);
    expect(summary(result.lines)).toEqual([
      ["cost", 1000, null, null],
      ["paid", 200, null, null],
      ["rc", -200, null, null]
    ]);
  });

  it("replays an untaxed bill exactly as toTransactionCurrencyLines does", () => {
    const legs = [
      leg("cost", 1050, { taxCodeId: null, taxPercent: 0 }),
      leg("ppv", -20, null)
    ];
    const result = plan(legs, [], 1133, 1.1);
    expect(result.sendsTax).toBe(false);
    expect(result.lines.every((line) => line.tax === null)).toBe(true);
    expect(result.lines.map((line) => line.leg)).toEqual(
      toTransactionCurrencyLines(legs, {
        exchangeRate: 1.1,
        documentTotal: 1133,
        decimalPlaces: 2
      })
    );
    expect(result.lines.map((line) => line.amount)).toEqual([1155, -22]);
  });

  it("refuses with the UNMAPPED_TAX_CODES Warning when the code's legs cannot absorb its net", () => {
    expect(() =>
      plan(
        [leg("cost", 600), leg("other", 600, null), taxPaid("paid", 200)],
        [ledger("uk20", 0.2, 200, 200)],
        1400
      )
    ).toThrow(
      expect.objectContaining({
        failure: expect.objectContaining({
          errorCode: "UNMAPPED_TAX_CODES",
          warning: true
        })
      })
    );
  });

  it("refuses with the UNMAPPED_TAX_CODES Warning when the ledger disagrees with Tax Paid", () => {
    expect(() =>
      plan(
        [leg("cost", 1000), taxPaid("paid", 200)],
        [ledger("uk20", 0.2, 200, 150)],
        1200
      )
    ).toThrow(
      expect.objectContaining({
        failure: expect.objectContaining({
          errorCode: "UNMAPPED_TAX_CODES",
          warning: true
        })
      })
    );
  });

  it("allocates a single leg the way a supplier memo splits", () => {
    expect(
      allocateRecoverableTax({
        document,
        legs: [leg("memo", 1100)],
        recoverableTaxByCode: new Map([["uk20", 100]]),
        decimalPlaces: 2
      }).map((line) => [line.amount, line.tax?.taxAmount ?? null])
    ).toEqual([
      [500, 100],
      [600, null]
    ]);
  });
});
