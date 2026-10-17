// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import type { CostingLine } from "../../../../core/document-costing";
import { JournalEntrySyncError } from "../../../../core/posting";
import { buildTaxCodeMappingLookup } from "../../../../core/tax-mapping";
import type { Accounting } from "../../../../core/types";
import type { Xero } from "../../models";
import { toXeroTaxRateOptions } from "../../provider";
import type { XeroTaxContext } from "../../tax";
import { BillSyncer, buildXeroBillLineItems, toXeroBillCosting } from "../bill";

/**
 * Xero ACCPAY bills are an account-costed replay of the posted Purchase
 * Invoice journal: AccountCode = the journal's mapped account, tax-neutral
 * (TaxType NONE), transaction-currency amounts with CurrencyRate pinned.
 */

const CODES: ReadonlyMap<string, string> = new Map([
  ["acct_grir", "2125"],
  ["acct_ppv", "5210"]
]);

/** A UK organisation's purchase rates, as GET /TaxRates returns them. */
const XERO_TAX_RATES: Xero.TaxRate[] = [
  {
    TaxType: "INPUT2",
    Name: "20% (VAT on Expenses)",
    EffectiveRate: 20,
    CanApplyToRevenue: false,
    CanApplyToExpenses: true
  },
  { TaxType: "NONE", Name: "No VAT", EffectiveRate: 0 }
];

/** "UK Standard 20%" mapped to INPUT2 for purchases. */
const TAX_CONTEXT: XeroTaxContext = {
  mappings: buildTaxCodeMappingLookup([
    {
      taxCodeId: "tc_uk20",
      direction: "purchase",
      externalId: "INPUT2",
      externalName: "20% (VAT on Expenses)",
      externalRate: 0.2
    }
  ]),
  options: toXeroTaxRateOptions(XERO_TAX_RATES)
};

/** A cost leg whose invoice line is at 20%, `recoverableShare` recoverable. */
const taxedLeg = (
  id: string,
  amount: number,
  recoverableShare: number,
  accountId = "acct_grir"
): CostingLine => ({
  id,
  accountId,
  amount,
  description: "GR/IR Clearing",
  tax: { taxCodeId: "tc_uk20", taxPercent: 0.2, recoverableShare }
});

const taxPaidLeg = (id: string, amount: number): CostingLine => ({
  id,
  accountId: "acct_tax_paid",
  amount,
  description: "Tax Paid",
  taxLeg: true,
  tax: null
});

/** Converts like the syncer, without a database. */
const xeroBillLines = async (lines: CostingLine[], documentTotal: number) => {
  const costing = await toXeroBillCosting(
    { lines, exchangeRate: 1, documentTotal, decimalPlaces: 2 },
    async () => TAX_CONTEXT
  );
  return buildXeroBillLineItems({
    bill: bill(),
    costingLines: costing.lines,
    accountCodesById: CODES,
    tax: costing.tax
  });
};

const bill = (overrides: Partial<Accounting.Bill> = {}): Accounting.Bill =>
  ({
    id: "pi_1",
    companyId: "company-1",
    invoiceId: "AP000001",
    supplierId: "sup_1",
    supplierExternalId: "contact-1",
    status: "Pending",
    dateIssued: "2026-08-04",
    dateDue: null,
    datePaid: null,
    currencyCode: "USD",
    exchangeRate: 1,
    subtotal: 300,
    totalTax: 0,
    totalDiscount: 0,
    totalAmount: 300,
    balance: 300,
    supplierReference: null,
    lines: [],
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides
  }) as unknown as Accounting.Bill;

describe("buildXeroBillLineItems (account-costed journal replay)", () => {
  it("maps to the journal account codes, TaxType NONE, item label, ItemCode only for known-non-tracked", () => {
    const costingLines: CostingLine[] = [
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
    ];

    const lines = buildXeroBillLineItems({
      bill: bill(),
      costingLines,
      accountCodesById: CODES,
      nonTrackedItemIds: new Set(["item-1"])
    });

    expect(lines).toEqual([
      {
        Description: "WIDGET-1 Widget",
        LineAmount: 280,
        AccountCode: "2125",
        TaxType: "NONE",
        ItemCode: "WIDGET-1"
      },
      {
        Description: "Purchase Price Variance",
        LineAmount: 20,
        AccountCode: "5210",
        TaxType: "NONE"
      }
    ]);
  });

  it("omits ItemCode when the item is not known non-tracked", () => {
    const lines = buildXeroBillLineItems({
      bill: bill(),
      costingLines: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 280,
          description: "GR/IR",
          sourceItem: { id: "item-1", code: "WIDGET-1", name: "Widget" }
        }
      ],
      accountCodesById: CODES
      // nonTrackedItemIds omitted → nothing known non-tracked
    });
    expect("ItemCode" in lines[0]!).toBe(false);
  });

  it("passes a negative (credit PPV) line through", () => {
    const lines = buildXeroBillLineItems({
      bill: bill(),
      costingLines: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300,
          description: "GR/IR"
        },
        { id: "jl-2", accountId: "acct_ppv", amount: -20, description: "PPV" }
      ],
      accountCodesById: CODES
    });
    expect(lines[1]?.LineAmount).toBe(-20);
  });

  it("warns (UNMAPPED_ACCOUNTS) on an unmapped account", () => {
    try {
      buildXeroBillLineItems({
        bill: bill(),
        costingLines: [
          {
            id: "jl-1",
            accountId: "acct_grir",
            amount: 300,
            description: "GR/IR"
          }
        ],
        accountCodesById: new Map()
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const failure = (error as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.warning).toBe(true);
    }
  });

  it("warns when the bill has no posted journal", () => {
    expect(() =>
      buildXeroBillLineItems({
        bill: bill(),
        costingLines: [],
        accountCodesById: CODES
      })
    ).toThrowError(JournalEntrySyncError);
  });
});

// Table-dispatching Kysely fake for the mapToRemote drive.
function makeBillDb(config: {
  purchaseInvoice: { currencyCode: string; exchangeRate: number };
  invoiceLines?: Array<Record<string, unknown>>;
  taxLedger?: Array<Record<string, unknown>>;
  taxMappings?: Array<{
    entityId: string;
    externalId: string;
    metadata: unknown;
  }>;
  journalLine: Array<{
    id: string;
    accountId: string | null;
    amount: number;
    description: string | null;
    documentLineReference: string | null;
    accountClass: string | null;
  }>;
  accountDefault: { payablesAccount: string | null };
  accountMappings: Array<{
    id: string;
    accountId: string;
    externalId: string | null;
    metadata: unknown;
    lastSyncedAt: string | null;
    accountNumber: string | null;
    accountName: string | null;
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
        if (table === "journalLine") return config.journalLine;
        if (table === "taxLedger") return config.taxLedger ?? [];
        if (table === "externalIntegrationMapping")
          return config.taxMappings ?? [];
        if (table === "purchaseInvoiceLine" && config.invoiceLines)
          return config.invoiceLines;
        if (table === "purchaseInvoiceLine")
          return [
            {
              quantity: 1,
              supplierUnitPrice: 100 * config.purchaseInvoice.exchangeRate,
              supplierShippingCost: 0,
              supplierTaxAmount: 0
            }
          ];
        if (table === "journalLineDimension") return [];
        if (table === "purchaseOrderLine") return [];
        if (table === "externalIntegrationMapping as m")
          return config.accountMappings;
        return [];
      },
      async executeTakeFirst() {
        if (table === "purchaseInvoice")
          return { ...config.purchaseInvoice, postingDate: "2026-09-07" };
        if (table === "company")
          return { baseCurrencyCode: "USD", companyGroupId: "group-1" };
        if (table === "currency") return { decimalPlaces: 2 };
        if (table === "accountDefault") return config.accountDefault;
        return undefined;
      }
    };
    return builder;
  };
  return { selectFrom: (t: string) => makeBuilder(t) } as never;
}

function makeBillSyncer(db: never, remoteId: string | null) {
  const syncer = new BillSyncer({
    database: db,
    companyId: "company-1",
    provider: {
      id: "xero",
      settings: {},
      listTaxRates: async () => XERO_TAX_RATES
    } as never,
    config: { enabled: true, direction: "two-way", owner: "accounting" },
    entityType: "bill"
  });
  (syncer as unknown as Record<string, unknown>).getRemoteId = async () =>
    remoteId;
  return syncer as unknown as {
    mapToRemote(local: Accounting.Bill): Promise<Xero.Invoice>;
    shouldSync(context: {
      direction: "push" | "pull";
      localEntity: Accounting.Bill;
    }): boolean | string;
  };
}

describe("BillSyncer.mapToRemote (FX + guards)", () => {
  const fxDb = (exchangeRate = 0.8) =>
    makeBillDb({
      purchaseInvoice: { currencyCode: "EUR", exchangeRate },
      journalLine: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 100,
          description: "GR/IR Clearing",
          documentLineReference: null,
          accountClass: "Asset"
        },
        {
          id: "jl-2",
          accountId: "acct_ap",
          amount: 100,
          description: "Accounts Payable",
          documentLineReference: null,
          accountClass: "Liability"
        }
      ],
      accountDefault: { payablesAccount: "acct_ap" },
      accountMappings: [
        {
          id: "m-1",
          accountId: "acct_grir",
          externalId: "grir-remote",
          metadata: { externalCode: "2125" },
          lastSyncedAt: null,
          accountNumber: "2125",
          accountName: "GR/IR Clearing"
        }
      ]
    });

  it("pins CurrencyRate and replays transaction-currency amounts (AP excluded)", async () => {
    const payload = await makeBillSyncer(fxDb(), null).mapToRemote(
      bill({ currencyCode: "EUR", exchangeRate: 0.8 })
    );

    expect(payload.CurrencyCode).toBe("EUR");
    expect(payload.CurrencyRate).toBe(0.8);
    expect(payload.LineItems).toEqual([
      {
        Description: "GR/IR Clearing",
        LineAmount: 80,
        AccountCode: "2125",
        TaxType: "NONE"
      }
    ]);
    // Tax-neutral replay: no totals sent (Xero computes from NONE-taxed lines).
    expect(payload.SubTotal).toBeUndefined();
    expect(payload.TotalTax).toBeUndefined();
  });

  it("pins a foreign identity rate instead of letting Xero choose a rate", async () => {
    const payload = await makeBillSyncer(fxDb(1), null).mapToRemote(
      bill({ currencyCode: "EUR", exchangeRate: 1 })
    );
    expect(payload.CurrencyRate).toBe(1);
  });

  it("lands a DOC_HAS_PAYMENTS Warning when re-pushing a paid bill", async () => {
    try {
      await makeBillSyncer(fxDb(), "xero-bill-1").mapToRemote(
        bill({ status: "Paid" })
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      const failure = (error as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("DOC_HAS_PAYMENTS");
      expect(failure.warning).toBe(true);
    }
  });

  it("skips a Draft bill in shouldSync", () => {
    const result = makeBillSyncer(fxDb(), null).shouldSync({
      direction: "push",
      localEntity: bill({ status: "Draft" })
    });
    expect(result).toContain("must be posted");
  });
});

it("refuses unsupported Xero bill monetary precision without changing principal", () => {
  expect(() =>
    buildXeroBillLineItems({
      bill: bill(),
      costingLines: [
        {
          id: "cost",
          accountId: "acct_grir",
          amount: 1.001,
          description: "Subcent cost"
        }
      ],
      accountCodesById: CODES
    })
  ).toThrow(/Xero.*precision|Xero.*decimal/i);
});
it.each([false, true])(
  "opts into supported unit precision at the actual bill transport (batch=%s)",
  async (batch) => {
    const syncer = makeBillSyncer({} as never, null) as any;
    const requests: string[] = [];
    syncer.provider.request = async (_method: string, url: string) => {
      requests.push(url);
      return { data: { Invoices: [{ InvoiceID: "remote" }] } };
    };
    const payload = {
      Type: "ACCPAY",
      InvoiceNumber: "AP000001",
      LineItems: [{ LineAmount: 10, AccountCode: "2125", TaxType: "NONE" }]
    };
    if (batch) await syncer.upsertRemoteBatch([{ localId: "pi_1", payload }]);
    else await syncer.upsertRemote(payload, "pi_1");
    expect(requests).toEqual(["/Invoices?unitdp=4"]);
  }
);

/**
 * Recoverable purchase tax (grill 10). The posting books recoverable tax to
 * Tax Paid and folds the non-recoverable share into cost, so a cost leg is
 * net + non-recoverable tax. Xero takes one rate per line: the recoverable
 * part of the net goes at the mapped rate with the recoverable tax, the rest
 * at NONE on the same account.
 */
describe("buildXeroBillLineItems (recoverable tax)", () => {
  it("keeps the tax-neutral replay when the bill has no Tax Paid leg", async () => {
    const getContext = vi.fn(async () => TAX_CONTEXT);
    const costing = await toXeroBillCosting(
      {
        // 0% recoverable: all £200 of tax is in the cost leg.
        lines: [taxedLeg("jl-1", 1200, 0)],
        exchangeRate: 1,
        documentTotal: 1200,
        decimalPlaces: 2
      },
      getContext
    );
    expect(costing.tax).toBeUndefined();
    expect(getContext).not.toHaveBeenCalled();
    expect(
      buildXeroBillLineItems({
        bill: bill(),
        costingLines: costing.lines,
        accountCodesById: CODES,
        tax: costing.tax
      })
    ).toEqual([
      {
        Description: "GR/IR Clearing",
        LineAmount: 1200,
        AccountCode: "2125",
        TaxType: "NONE"
      }
    ]);
  });

  it("sends a fully recoverable line as its net at the mapped rate with the tax", async () => {
    const lines = await xeroBillLines(
      [taxedLeg("jl-1", 1000, 1), taxPaidLeg("jl-2", 200)],
      1200
    );
    expect(lines).toEqual([
      {
        Description: "GR/IR Clearing",
        LineAmount: 1000,
        AccountCode: "2125",
        TaxType: "INPUT2",
        TaxAmount: 200
      }
    ]);
  });

  it("splits a 50% recoverable line into the recoverable part and the rest at NONE", async () => {
    // £1,000 net at 20%, half recoverable: cost £1,100, Tax Paid £100.
    const lines = await xeroBillLines(
      [taxedLeg("jl-1", 1100, 0.5), taxPaidLeg("jl-2", 100)],
      1200
    );
    expect(
      lines.map((line) => [
        line.AccountCode,
        line.LineAmount,
        line.TaxType,
        line.TaxAmount
      ])
    ).toEqual([
      ["2125", 500, "INPUT2", 100],
      ["2125", 600, "NONE", undefined]
    ]);
  });

  it("spreads the Tax Paid legs across lines so they sum exactly", async () => {
    // 33.33 + 66.67 at 20% is 6.666 + 13.334: rounded alone, 6.67 + 13.33.
    const lines = await xeroBillLines(
      [
        taxedLeg("jl-1", 33.33, 1),
        taxedLeg("jl-2", 66.67, 1, "acct_ppv"),
        taxPaidLeg("jl-3", 20)
      ],
      120
    );
    expect(lines.map((line) => line.TaxAmount)).toEqual([6.67, 13.33]);
    expect(
      lines.reduce(
        (sum, line) => sum + line.LineAmount! + (line.TaxAmount ?? 0),
        0
      )
    ).toBeCloseTo(120, 6);
  });

  it("refuses a leg it cannot tie to one tax code with the UNMAPPED_TAX_CODES Warning", async () => {
    await expect(
      xeroBillLines(
        [
          taxedLeg("jl-1", 1000, 1),
          { ...taxedLeg("jl-2", 50, 1, "acct_ppv"), tax: null },
          taxPaidLeg("jl-3", 200)
        ],
        1250
      )
    ).rejects.toMatchObject({
      failure: {
        errorCode: "UNMAPPED_TAX_CODES",
        warning: true,
        metadata: expect.objectContaining({ journalLineIds: ["jl-2"] })
      }
    });
  });

  it("refuses an unmapped tax code with the UNMAPPED_TAX_CODES Warning", async () => {
    await expect(
      xeroBillLines(
        [
          {
            ...taxedLeg("jl-1", 1000, 1),
            tax: { taxCodeId: "tc_other", taxPercent: 0.2, recoverableShare: 1 }
          },
          taxPaidLeg("jl-2", 200)
        ],
        1200
      )
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_TAX_CODES", warning: true }
    });
  });
});

describe("buildXeroBillLineItems (zero-rated and non-recoverable lines)", () => {
  /** "UK Zero Rated" mapped to ZERORATEDINPUT for purchases. */
  const context: XeroTaxContext = {
    mappings: buildTaxCodeMappingLookup([
      ...TAX_CONTEXT.mappings.values(),
      {
        taxCodeId: "tc_uk0",
        direction: "purchase",
        externalId: "ZERORATEDINPUT",
        externalName: "Zero Rated Expenses",
        externalRate: 0
      }
    ]),
    options: toXeroTaxRateOptions([
      ...XERO_TAX_RATES,
      {
        TaxType: "ZERORATEDINPUT",
        Name: "Zero Rated Expenses",
        EffectiveRate: 0,
        CanApplyToRevenue: false,
        CanApplyToExpenses: true
      }
    ])
  };
  const zeroRatedLeg = (id: string, amount: number): CostingLine => ({
    id,
    accountId: "acct_ppv",
    amount,
    description: "Books",
    tax: { taxCodeId: "tc_uk0", taxPercent: 0, recoverableShare: 0 }
  });
  const lines = async (costingLines: CostingLine[], documentTotal: number) => {
    const costing = await toXeroBillCosting(
      { lines: costingLines, exchangeRate: 1, documentTotal, decimalPlaces: 2 },
      async () => context
    );
    return buildXeroBillLineItems({
      bill: bill(),
      costingLines: costing.lines,
      accountCodesById: CODES,
      tax: costing.tax
    });
  };

  it("sends a zero-rated line at its mapped rate with TaxAmount 0, so Xero counts its net", async () => {
    expect(await lines([zeroRatedLeg("jl-1", 300)], 300)).toEqual([
      {
        Description: "Books",
        LineAmount: 300,
        AccountCode: "5210",
        TaxType: "ZERORATEDINPUT",
        TaxAmount: 0
      }
    ]);
  });

  it("keeps a taxed, non-recoverable line at NONE beside a zero-rated one", async () => {
    const result = await lines(
      [taxedLeg("jl-1", 1200, 0), zeroRatedLeg("jl-2", 300)],
      1500
    );
    expect(
      result.map((line) => [line.LineAmount, line.TaxType, line.TaxAmount])
    ).toEqual([
      [1200, "NONE", undefined],
      [300, "ZERORATEDINPUT", 0]
    ]);
  });

  it("refuses an unmapped zero-rated code with the UNMAPPED_TAX_CODES Warning", async () => {
    await expect(
      lines(
        [
          {
            ...zeroRatedLeg("jl-1", 300),
            tax: { taxCodeId: "tc_exempt", taxPercent: 0, recoverableShare: 0 }
          }
        ],
        300
      )
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_TAX_CODES", warning: true }
    });
  });

  it("keeps a bill with no code and no recoverable tax tax-neutral, without reading tax rates", async () => {
    const getContext = vi.fn(async () => context);
    const costing = await toXeroBillCosting(
      {
        lines: [
          {
            ...taxedLeg("jl-1", 1100, 0),
            tax: { taxCodeId: null, taxPercent: 0.1, recoverableShare: 0 }
          },
          { ...taxedLeg("jl-2", 50, 0, "acct_ppv"), tax: null }
        ],
        exchangeRate: 1,
        documentTotal: 1150,
        decimalPlaces: 2
      },
      getContext
    );
    expect(costing.tax).toBeUndefined();
    expect(getContext).not.toHaveBeenCalled();
  });
});

describe("BillSyncer.mapToRemote (recoverable tax)", () => {
  it("sends Exclusive line amounts with the mapped TaxType", async () => {
    const db = makeBillDb({
      purchaseInvoice: { currencyCode: "GBP", exchangeRate: 1 },
      invoiceLines: [
        {
          id: "pil-1",
          purchaseOrderLineId: null,
          accountId: "acct_grir",
          taxCodeId: "tc_uk20",
          taxPercent: 0.2,
          quantity: 1,
          supplierUnitPrice: 1000,
          supplierShippingCost: 0,
          supplierTaxAmount: 200
        }
      ],
      taxLedger: [
        {
          documentLineId: "pil-1",
          taxCodeId: "tc_uk20",
          taxCodeComponentId: "tcc_1",
          taxPercent: 0.2,
          taxableAmount: 1000,
          taxAmount: 200,
          recoverableAmount: 200
        }
      ],
      taxMappings: [
        {
          entityId: "tc_uk20:purchase",
          externalId: "INPUT2",
          metadata: { externalName: "20% (VAT on Expenses)", externalRate: 0.2 }
        }
      ],
      journalLine: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 1000,
          description: "GR/IR Clearing",
          documentLineReference: null,
          accountClass: "Asset"
        },
        {
          id: "jl-2",
          accountId: "acct_tax_paid",
          amount: 200,
          description: "Tax Paid",
          documentLineReference: null,
          accountClass: "Asset"
        },
        {
          id: "jl-3",
          accountId: "acct_ap",
          amount: 1200,
          description: "Accounts Payable",
          documentLineReference: null,
          accountClass: "Liability"
        }
      ],
      accountDefault: { payablesAccount: "acct_ap" },
      accountMappings: [
        {
          id: "m-1",
          accountId: "acct_grir",
          externalId: "grir-remote",
          metadata: { externalCode: "2125" },
          lastSyncedAt: null,
          accountNumber: "2125",
          accountName: "GR/IR Clearing"
        }
      ]
    });
    const payload = await makeBillSyncer(db, null).mapToRemote(
      bill({ currencyCode: "GBP" })
    );
    expect(payload.LineAmountTypes).toBe("Exclusive");
    expect(payload.LineItems).toEqual([
      {
        Description: "GR/IR Clearing",
        LineAmount: 1000,
        AccountCode: "2125",
        TaxType: "INPUT2",
        TaxAmount: 200
      }
    ]);
  });
});
