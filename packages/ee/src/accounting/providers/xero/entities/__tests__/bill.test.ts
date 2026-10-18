// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import {
  type BillTaxLedgerRow,
  type BillTaxLine,
  type CostingLine,
  planBillTaxLines
} from "../../../../core/document-costing";
import { JournalEntrySyncError } from "../../../../core/posting";
import { buildTaxCodeMappingLookup } from "../../../../core/tax-mapping";
import type { Accounting } from "../../../../core/types";
import type { Xero } from "../../models";
import { toXeroTaxRateOptions } from "../../provider";
import type { XeroTaxContext } from "../../tax";
import { BillSyncer, buildXeroBillLineItems } from "../bill";

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

/** A cost leg whose invoice line is at 20%. */
const taxedLeg = (
  id: string,
  amount: number,
  accountId = "acct_grir"
): CostingLine => ({
  id,
  accountId,
  amount,
  description: "GR/IR Clearing",
  tax: { taxCodeId: "tc_uk20", taxPercent: 0.2 }
});

/** The tax ledger's recoverable tax of one code, base currency. */
const recoverable = (
  taxCodeId: string,
  recoverableAmount: number
): BillTaxLedgerRow => ({
  documentLineId: "pil-1",
  taxCodeId,
  taxCodeComponentId: null,
  taxPercent: 0.2,
  taxableAmount: 0,
  taxAmount: recoverableAmount,
  recoverableAmount
});

/** Legs replayed one line each, at no tax. */
const untaxed = (legs: CostingLine[]): BillTaxLine[] =>
  legs.map((leg) => ({ leg, amount: leg.amount, tax: null }));

const taxPaidLeg = (id: string, amount: number): CostingLine => ({
  id,
  accountId: "acct_tax_paid",
  amount,
  description: "Tax Paid",
  taxLeg: true,
  tax: null
});

/** Plans and builds like the syncer, without a database. */
const xeroBillLines = (
  lines: CostingLine[],
  documentTotal: number,
  taxLedger: BillTaxLedgerRow[],
  context: XeroTaxContext = TAX_CONTEXT
) => {
  const plan = planBillTaxLines(
    { lines, taxLedger, exchangeRate: 1, documentTotal, decimalPlaces: 2 },
    { id: "pi_1", label: "bill AP000001" }
  );
  return buildXeroBillLineItems({
    bill: bill(),
    lines: plan.lines,
    accountCodesById: CODES,
    tax: plan.sendsTax ? { context, decimalPlaces: 2 } : undefined
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
      lines: untaxed(costingLines),
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
      lines: untaxed([
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 280,
          description: "GR/IR",
          sourceItem: { id: "item-1", code: "WIDGET-1", name: "Widget" }
        }
      ]),
      accountCodesById: CODES
      // nonTrackedItemIds omitted → nothing known non-tracked
    });
    expect("ItemCode" in lines[0]!).toBe(false);
  });

  it("passes a negative (credit PPV) line through", () => {
    const lines = buildXeroBillLineItems({
      bill: bill(),
      lines: untaxed([
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300,
          description: "GR/IR"
        },
        { id: "jl-2", accountId: "acct_ppv", amount: -20, description: "PPV" }
      ]),
      accountCodesById: CODES
    });
    expect(lines[1]?.LineAmount).toBe(-20);
  });

  it("warns (UNMAPPED_ACCOUNTS) on an unmapped account", () => {
    try {
      buildXeroBillLineItems({
        bill: bill(),
        lines: untaxed([
          {
            id: "jl-1",
            accountId: "acct_grir",
            amount: 300,
            description: "GR/IR"
          }
        ]),
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
        lines: untaxed([]),
        accountCodesById: CODES
      })
    ).toThrowError(JournalEntrySyncError);
  });
});

// Table-dispatching Kysely fake for the mapToRemote drive.
function makeBillDb(config: {
  purchaseInvoice: { currencyCode: string; exchangeRate: number };
  invoiceLines?: Array<Record<string, unknown>>;
  /** The header freight (`purchaseInvoiceDelivery.supplierShippingCost`). */
  delivery?: number;
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
        if (table === "purchaseInvoiceDelivery" && config.delivery)
          return { supplierShippingCost: config.delivery };
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
      lines: untaxed([
        {
          id: "cost",
          accountId: "acct_grir",
          amount: 1.001,
          description: "Subcent cost"
        }
      ]),
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
 * Recoverable purchase tax. The posting books recoverable tax to Tax Paid and
 * folds the non-recoverable share into cost, so a cost leg is the net plus
 * the non-recoverable tax. Xero takes one rate per line: the recoverable net
 * (the code's recoverable tax from the ledger, over its rate) goes at the
 * mapped rate with that tax, the rest of the leg at NONE on the same account.
 */
describe("buildXeroBillLineItems (recoverable tax)", () => {
  it("keeps the tax-neutral replay when the bill has no Tax Paid leg", () => {
    // 0% recoverable: all £200 of tax is in the cost leg.
    const plan = planBillTaxLines(
      {
        lines: [taxedLeg("jl-1", 1200)],
        taxLedger: [recoverable("tc_uk20", 0)],
        exchangeRate: 1,
        documentTotal: 1200,
        decimalPlaces: 2
      },
      { id: "pi_1", label: "bill AP000001" }
    );
    expect(plan.sendsTax).toBe(false);
    expect(
      buildXeroBillLineItems({
        bill: bill(),
        lines: plan.lines,
        accountCodesById: CODES
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

  it("sends a fully recoverable line as its net at the mapped rate with the tax", () => {
    const lines = xeroBillLines(
      [taxedLeg("jl-1", 1000), taxPaidLeg("jl-2", 200)],
      1200,
      [recoverable("tc_uk20", 200)]
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

  it("splits a 50% recoverable line into the recoverable part and the rest at NONE", () => {
    // £1,000 net at 20%, half recoverable: cost £1,100, Tax Paid £100.
    const lines = xeroBillLines(
      [taxedLeg("jl-1", 1100), taxPaidLeg("jl-2", 100)],
      1200,
      [recoverable("tc_uk20", 100)]
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

  it("spreads the Tax Paid legs across lines so they sum exactly", () => {
    // 33.33 + 66.67 at 20% is 6.666 + 13.334: rounded alone, 6.67 + 13.33.
    const lines = xeroBillLines(
      [
        taxedLeg("jl-1", 33.33),
        taxedLeg("jl-2", 66.67, "acct_ppv"),
        taxPaidLeg("jl-3", 20)
      ],
      120,
      [recoverable("tc_uk20", 20)]
    );
    expect(lines.map((line) => line.TaxAmount)).toEqual([6.67, 13.33]);
    expect(
      lines.reduce(
        (sum, line) => sum + line.LineAmount! + (line.TaxAmount ?? 0),
        0
      )
    ).toBeCloseTo(120, 6);
  });

  it("sends a leg it cannot tie to one tax code at NONE when the code's other legs absorb its tax", () => {
    const lines = xeroBillLines(
      [
        taxedLeg("jl-1", 1000),
        { ...taxedLeg("jl-2", 50, "acct_ppv"), tax: null },
        taxPaidLeg("jl-3", 200)
      ],
      1250,
      [recoverable("tc_uk20", 200)]
    );
    expect(
      lines.map((line) => [line.LineAmount, line.TaxType, line.TaxAmount])
    ).toEqual([
      [1000, "INPUT2", 200],
      [50, "NONE", undefined]
    ]);
  });

  it("refuses with the UNMAPPED_TAX_CODES Warning when no leg can be tied to the code", () => {
    expect(() =>
      xeroBillLines(
        [{ ...taxedLeg("jl-1", 1000), tax: null }, taxPaidLeg("jl-2", 200)],
        1200,
        [recoverable("tc_uk20", 200)]
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

  it("refuses an unmapped tax code with the UNMAPPED_TAX_CODES Warning", () => {
    expect(() =>
      xeroBillLines(
        [
          {
            ...taxedLeg("jl-1", 1000),
            tax: { taxCodeId: "tc_other", taxPercent: 0.2 }
          },
          taxPaidLeg("jl-2", 200)
        ],
        1200,
        [recoverable("tc_other", 200)]
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
    tax: { taxCodeId: "tc_uk0", taxPercent: 0 }
  });
  const lines = (costingLines: CostingLine[], documentTotal: number) =>
    xeroBillLines(costingLines, documentTotal, [], context);

  it("sends a zero-rated line at its mapped rate with TaxAmount 0, so Xero counts its net", () => {
    expect(lines([zeroRatedLeg("jl-1", 300)], 300)).toEqual([
      {
        Description: "Books",
        LineAmount: 300,
        AccountCode: "5210",
        TaxType: "ZERORATEDINPUT",
        TaxAmount: 0
      }
    ]);
  });

  it("keeps a taxed, non-recoverable line at NONE beside a zero-rated one", () => {
    const result = lines(
      [taxedLeg("jl-1", 1200), zeroRatedLeg("jl-2", 300)],
      1500
    );
    expect(
      result.map((line) => [line.LineAmount, line.TaxType, line.TaxAmount])
    ).toEqual([
      [1200, "NONE", undefined],
      [300, "ZERORATEDINPUT", 0]
    ]);
  });

  it("refuses an unmapped zero-rated code with the UNMAPPED_TAX_CODES Warning", () => {
    expect(() =>
      lines(
        [
          {
            ...zeroRatedLeg("jl-1", 300),
            tax: { taxCodeId: "tc_exempt", taxPercent: 0 }
          }
        ],
        300
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

  it("keeps a bill with no code and no recoverable tax tax-neutral", () => {
    const plan = planBillTaxLines(
      {
        lines: [
          {
            ...taxedLeg("jl-1", 1100),
            tax: { taxCodeId: null, taxPercent: 0.1 }
          },
          { ...taxedLeg("jl-2", 50, "acct_ppv"), tax: null }
        ],
        exchangeRate: 1,
        documentTotal: 1150,
        decimalPlaces: 2
      },
      { id: "pi_1", label: "bill AP000001" }
    );
    expect(plan.sendsTax).toBe(false);
    expect(plan.lines.every((line) => line.tax === null)).toBe(true);
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

/**
 * Bills whose recoverable tax comes from the tax ledger, driven through the
 * syncer as a posted bill: the invoice lines, the posted journal and the
 * ledger rows the posting wrote. A cost leg holds the net, the
 * non-recoverable tax and its share of the untaxed header freight, so its
 * taxable base cannot be derived from its amount.
 */
describe("BillSyncer.mapToRemote (tax from the ledger)", () => {
  const RATES: Xero.TaxRate[] = [
    ...XERO_TAX_RATES,
    {
      TaxType: "RRINPUT",
      Name: "5% (VAT on Expenses)",
      EffectiveRate: 5,
      CanApplyToRevenue: false,
      CanApplyToExpenses: true
    },
    {
      TaxType: "INPUT12",
      Name: "GST/PST on Purchases (12%)",
      EffectiveRate: 12,
      CanApplyToRevenue: false,
      CanApplyToExpenses: true
    }
  ];
  const mapping = (taxCodeId: string, externalId: string, rate: number) => ({
    entityId: `${taxCodeId}:purchase`,
    externalId,
    metadata: { externalName: externalId, externalRate: rate }
  });
  const account = (accountId: string, code: string) => ({
    id: `m-${accountId}`,
    accountId,
    externalId: `${accountId}-remote`,
    metadata: { externalCode: code },
    lastSyncedAt: null,
    accountNumber: code,
    accountName: accountId
  });
  const invoiceLine = (
    id: string,
    accountId: string,
    taxCodeId: string,
    taxPercent: number,
    net: number,
    tax: number
  ) => ({
    id,
    purchaseOrderLineId: null,
    accountId,
    taxCodeId,
    taxPercent,
    quantity: 1,
    supplierUnitPrice: net,
    supplierShippingCost: 0,
    supplierTaxAmount: tax
  });
  const ledgerRow = (
    documentLineId: string,
    taxCodeId: string,
    taxPercent: number,
    taxableAmount: number,
    taxAmount: number,
    recoverableAmount: number
  ) => ({
    documentLineId,
    taxCodeId,
    taxCodeComponentId: `${taxCodeId}-${taxPercent}`,
    taxPercent,
    taxableAmount,
    taxAmount,
    recoverableAmount
  });
  const journalLine = (
    id: string,
    accountId: string,
    amount: number,
    description: string,
    accountClass: string
  ) => ({
    id,
    accountId,
    amount,
    description,
    documentLineReference: null,
    accountClass
  });

  const push = async (
    config: Pick<
      Parameters<typeof makeBillDb>[0],
      "invoiceLines" | "delivery" | "taxLedger" | "journalLine"
    >,
    listTaxRates = vi.fn(async () => RATES)
  ) => {
    const db = makeBillDb({
      purchaseInvoice: { currencyCode: "USD", exchangeRate: 1 },
      ...config,
      taxMappings: [
        mapping("tc_uk20", "INPUT2", 0.2),
        mapping("tc_uk5", "RRINPUT", 0.05),
        mapping("tc_bc12", "INPUT12", 0.12)
      ],
      accountDefault: { payablesAccount: "acct_ap" },
      accountMappings: [
        account("acct_grir", "2125"),
        account("acct_ppv", "5210"),
        account("acct_tax_paid", "820"),
        account("acct_rc", "825")
      ]
    });
    const syncer = new BillSyncer({
      database: db,
      companyId: "company-1",
      provider: { id: "xero", settings: {}, listTaxRates } as never,
      config: { enabled: true, direction: "two-way", owner: "accounting" },
      entityType: "bill"
    });
    (syncer as unknown as Record<string, unknown>).getRemoteId = async () =>
      null;
    const payload = await (
      syncer as unknown as {
        mapToRemote(local: Accounting.Bill): Promise<Xero.Invoice>;
      }
    ).mapToRemote(bill());
    return { payload, listTaxRates };
  };
  const summary = (payload: Xero.Invoice) =>
    payload.LineItems!.map((line) => [
      line.AccountCode,
      line.LineAmount,
      line.TaxType,
      line.TaxAmount
    ]);
  const total = (payload: Xero.Invoice) =>
    payload.LineItems!.reduce(
      (sum, line) => sum + line.LineAmount! + (line.TaxAmount ?? 0),
      0
    );

  it("sends a fully recoverable bill with header freight: the net taxed, the freight at NONE", async () => {
    // £1,000 at 20%, all recoverable, plus £50 of untaxed header freight.
    const { payload } = await push({
      invoiceLines: [
        invoiceLine("pil-1", "acct_grir", "tc_uk20", 0.2, 1000, 200)
      ],
      delivery: 50,
      taxLedger: [ledgerRow("pil-1", "tc_uk20", 0.2, 1000, 200, 200)],
      journalLine: [
        journalLine("jl-1", "acct_grir", 1050, "GR/IR Clearing", "Asset"),
        journalLine("jl-2", "acct_tax_paid", 200, "Tax Paid", "Asset"),
        journalLine("jl-3", "acct_ap", 1250, "Accounts Payable", "Liability")
      ]
    });
    expect(payload.LineAmountTypes).toBe("Exclusive");
    expect(summary(payload)).toEqual([
      ["2125", 1000, "INPUT2", 200],
      ["2125", 50, "NONE", undefined]
    ]);
    expect(total(payload)).toBeCloseTo(1250, 6);
  });

  it("sends a large bill whose recoverable share does not terminate (GST 5% of 12%)", async () => {
    // $29,900.05 at 12% (GST 5% recoverable, PST 7% not): the share is 5/12.
    const { payload } = await push({
      invoiceLines: [
        invoiceLine("pil-1", "acct_grir", "tc_bc12", 0.12, 29900.05, 3588.01)
      ],
      taxLedger: [
        ledgerRow("pil-1", "tc_bc12", 0.05, 29900.05, 1495.00417, 1495.00417),
        ledgerRow("pil-1", "tc_bc12", 0.07, 29900.05, 2093.00583, 0)
      ],
      journalLine: [
        journalLine(
          "jl-1",
          "acct_grir",
          31993.05583,
          "GR/IR Clearing",
          "Asset"
        ),
        journalLine("jl-2", "acct_tax_paid", 1495.00417, "Tax Paid", "Asset"),
        journalLine(
          "jl-3",
          "acct_ap",
          33488.06,
          "Accounts Payable",
          "Liability"
        )
      ]
    });
    expect(summary(payload)).toEqual([
      ["2125", 12458.33, "INPUT12", 1495],
      ["2125", 19534.73, "NONE", undefined]
    ]);
    expect(total(payload)).toBeCloseTo(33488.06, 6);
  });

  it("sends a 50% recoverable bill with header freight: the recoverable net taxed, the rest at NONE", async () => {
    // £1,000 at 20%, half recoverable: cost £1,100 plus £50 freight.
    const { payload } = await push({
      invoiceLines: [
        invoiceLine("pil-1", "acct_grir", "tc_uk20", 0.2, 1000, 200)
      ],
      delivery: 50,
      taxLedger: [ledgerRow("pil-1", "tc_uk20", 0.2, 1000, 200, 100)],
      journalLine: [
        journalLine("jl-1", "acct_grir", 1150, "GR/IR Clearing", "Asset"),
        journalLine("jl-2", "acct_tax_paid", 100, "Tax Paid", "Asset"),
        journalLine("jl-3", "acct_ap", 1250, "Accounts Payable", "Liability")
      ]
    });
    expect(summary(payload)).toEqual([
      ["2125", 500, "INPUT2", 100],
      ["2125", 650, "NONE", undefined]
    ]);
  });

  it("sends a bill spanning two codes, each code's tax on its own legs", async () => {
    // £1,000 at 20% and £400 at 5%, both recoverable, plus £70 freight
    // weighted on the gross lines.
    const { payload } = await push({
      invoiceLines: [
        invoiceLine("pil-1", "acct_grir", "tc_uk20", 0.2, 1000, 200),
        invoiceLine("pil-2", "acct_ppv", "tc_uk5", 0.05, 400, 20)
      ],
      delivery: 70,
      taxLedger: [
        ledgerRow("pil-1", "tc_uk20", 0.2, 1000, 200, 200),
        ledgerRow("pil-2", "tc_uk5", 0.05, 400, 20, 20)
      ],
      journalLine: [
        journalLine("jl-1", "acct_grir", 1051.85185, "Travel", "Expense"),
        journalLine("jl-2", "acct_tax_paid", 200, "Tax Paid", "Asset"),
        journalLine("jl-3", "acct_ppv", 418.14815, "Books", "Expense"),
        journalLine("jl-4", "acct_tax_paid", 20, "Tax Paid", "Asset"),
        journalLine("jl-5", "acct_ap", 1690, "Accounts Payable", "Liability")
      ]
    });
    expect(summary(payload)).toEqual([
      ["2125", 1000, "INPUT2", 200],
      ["2125", 51.85, "NONE", undefined],
      ["5210", 400, "RRINPUT", 20],
      ["5210", 18.15, "NONE", undefined]
    ]);
    expect(total(payload)).toBeCloseTo(1690, 6);
  });

  it("sends a reverse-charge bill tax-neutral, every leg an account line, without reading tax rates", async () => {
    // £1,000 from an EU supplier at a 20% reverse charge, all recoverable:
    // Dr Tax Paid 200, Cr Reverse Charge Tax 200, AP stays at the net.
    const { payload, listTaxRates } = await push({
      invoiceLines: [
        invoiceLine("pil-1", "acct_grir", "tc_uk20", 0.2, 1000, 0)
      ],
      taxLedger: [ledgerRow("pil-1", "tc_uk20", 0.2, 1000, 200, 200)],
      journalLine: [
        journalLine("jl-1", "acct_grir", 1000, "GR/IR Clearing", "Asset"),
        journalLine("jl-2", "acct_tax_paid", 200, "Tax Paid", "Asset"),
        journalLine("jl-3", "acct_rc", 200, "Reverse Charge Tax", "Liability"),
        journalLine("jl-4", "acct_ap", 1000, "Accounts Payable", "Liability")
      ]
    });
    expect(payload.LineAmountTypes).toBeUndefined();
    expect(summary(payload)).toEqual([
      ["2125", 1000, "NONE", undefined],
      ["820", 200, "NONE", undefined],
      ["825", -200, "NONE", undefined]
    ]);
    expect(listTaxRates).not.toHaveBeenCalled();
  });

  it("sends an untaxed bill with header freight exactly as before, without reading tax rates", async () => {
    const { payload, listTaxRates } = await push({
      invoiceLines: [
        {
          ...invoiceLine("pil-1", "acct_grir", "", 0, 1000, 0),
          taxCodeId: null
        }
      ],
      delivery: 50,
      journalLine: [
        journalLine("jl-1", "acct_grir", 1050, "GR/IR Clearing", "Asset"),
        journalLine("jl-2", "acct_ap", 1050, "Accounts Payable", "Liability")
      ]
    });
    expect(payload.LineAmountTypes).toBeUndefined();
    expect(payload.LineItems).toEqual([
      {
        Description: "GR/IR Clearing",
        LineAmount: 1050,
        AccountCode: "2125",
        TaxType: "NONE"
      }
    ]);
    expect(listTaxRates).not.toHaveBeenCalled();
  });
});
