// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type {
  BillTaxLedgerRow,
  CostingLine
} from "../../../../core/document-costing";
import { JournalEntrySyncError } from "../../../../core/posting";
import { buildTaxCodeMappingLookup } from "../../../../core/tax-mapping";
import type { Accounting } from "../../../../core/types";
import type { Qbo } from "../../models";
import {
  buildQboBillLines,
  buildQboBillPayloadLines,
  deriveCarbonBillStatus,
  QboBillSyncer
} from "../bill";
import type { QboInvoiceTaxCatalog } from "../invoice-tax";
import { buildQboExpenseLines, type QboExpenseLineInput } from "../shared";

const ACCOUNT_REFS: ReadonlyMap<string, Qbo.Ref> = new Map([
  ["acc-freight", { value: "91", name: "Freight & Delivery" }]
]);

const itemLine: QboExpenseLineInput = {
  itemId: "item-1",
  accountId: null,
  description: "Widget Bracket",
  quantity: 10,
  unitPrice: 4.255,
  totalAmount: 42.555
};

const accountLine: QboExpenseLineInput = {
  itemId: null,
  accountId: "acc-freight",
  description: "Inbound freight",
  quantity: 1,
  unitPrice: 25,
  totalAmount: 25
};

describe("buildQboExpenseLines (bill mapping fixture)", () => {
  it("maps item lines to ItemBasedExpenseLineDetail and account lines to AccountBasedExpenseLineDetail", () => {
    const lines = buildQboExpenseLines({
      lines: [itemLine, accountLine],
      itemRemoteIds: new Map([["item-1", "77"]]),
      accountRefsById: ACCOUNT_REFS,
      documentLabel: "bill PI-000042"
    });

    expect(lines).toEqual([
      {
        Description: "Widget Bracket",
        Amount: 42.56,
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: {
          ItemRef: { value: "77" },
          Qty: 10,
          UnitPrice: 4.255
        }
      },
      {
        Description: "Inbound freight",
        Amount: 25,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "91", name: "Freight & Delivery" }
        }
      }
    ]);
  });

  it("throws a plain error (Failed, not Warning) for a non-item line with an unmapped account", () => {
    expect(() =>
      buildQboExpenseLines({
        lines: [accountLine],
        itemRemoteIds: new Map(),
        accountRefsById: new Map(),
        documentLabel: "bill PI-000042"
      })
    ).toThrow(/account acc-freight has no QuickBooks Online account mapping/);
  });

  it("throws for a line with neither an item nor an account", () => {
    expect(() =>
      buildQboExpenseLines({
        lines: [{ ...accountLine, accountId: null }],
        itemRemoteIds: new Map(),
        accountRefsById: ACCOUNT_REFS,
        documentLabel: "bill PI-000042"
      })
    ).toThrow(/neither an item nor a G\/L account/);
  });

  it("throws for an item line whose item was not synced first", () => {
    expect(() =>
      buildQboExpenseLines({
        lines: [itemLine],
        itemRemoteIds: new Map(),
        accountRefsById: ACCOUNT_REFS,
        documentLabel: "bill PI-000042"
      })
    ).toThrow(/item item-1 has not been synced/);
  });
});

const BILL_ACCOUNT_REFS: ReadonlyMap<string, Qbo.Ref> = new Map([
  ["acc-grir", { value: "2125", name: "GR/IR Clearing" }],
  ["acc-ppv", { value: "5210", name: "Purchase Price Variance" }]
]);

const billFixture = (
  overrides: Partial<Accounting.Bill> = {}
): Accounting.Bill =>
  ({
    id: "pi_1",
    companyId: "company-1",
    invoiceId: "AP000001",
    supplierId: "sup_1",
    supplierExternalId: "vendor-99",
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

describe("buildQboBillLines (account-costed journal replay)", () => {
  it("emits AccountBasedExpenseLineDetail to the journal accounts, item label as Description, no item detail, no tax", () => {
    const costingLines: CostingLine[] = [
      {
        id: "jl-1",
        accountId: "acc-grir",
        amount: 300,
        description: "GR/IR Clearing",
        sourceItem: { id: "item-1", code: "WIDGET-1", name: "Widget" }
      },
      {
        id: "jl-2",
        accountId: "acc-ppv",
        amount: 20,
        description: "Purchase Price Variance"
      }
    ];

    const lines = buildQboBillLines({
      bill: billFixture(),
      costingLines,
      accountRefsById: BILL_ACCOUNT_REFS
    });

    expect(lines).toEqual([
      {
        Amount: 300,
        Description: "WIDGET-1 Widget",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "2125", name: "GR/IR Clearing" }
        }
      },
      {
        Amount: 20,
        Description: "Purchase Price Variance",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "5210", name: "Purchase Price Variance" }
        }
      }
    ]);
    // No item-based detail leaks onto a bill line.
    expect(lines.every((l) => !("ItemBasedExpenseLineDetail" in l))).toBe(true);
  });

  it("survives a negative (credit PPV) costing line", () => {
    const lines = buildQboBillLines({
      bill: billFixture(),
      costingLines: [
        {
          id: "jl-1",
          accountId: "acc-grir",
          amount: 300,
          description: "GR/IR"
        },
        {
          id: "jl-2",
          accountId: "acc-ppv",
          amount: -20,
          description: "PPV credit"
        }
      ],
      accountRefsById: BILL_ACCOUNT_REFS
    });
    expect(lines[1]?.Amount).toBe(-20);
  });

  it("warns (UNMAPPED_ACCOUNTS, retryable) on an unmapped account", () => {
    try {
      buildQboBillLines({
        bill: billFixture(),
        costingLines: [
          {
            id: "jl-1",
            accountId: "acc-grir",
            amount: 300,
            description: "GR/IR"
          }
        ],
        accountRefsById: new Map()
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const failure = (error as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.warning).toBe(true);
      expect(failure.metadata?.unmappedAccountIds).toEqual(["acc-grir"]);
    }
  });

  it("warns when the bill has no posted journal", () => {
    expect(() =>
      buildQboBillLines({
        bill: billFixture(),
        costingLines: [],
        accountRefsById: BILL_ACCOUNT_REFS
      })
    ).toThrowError(JournalEntrySyncError);
  });
});

// Table-dispatching Kysely fake for the mapToRemote FX drive.
function makeBillDb(config: {
  purchaseInvoice: { currencyCode: string; exchangeRate: number };
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
        if (table === "purchaseInvoiceLine")
          return [
            {
              quantity: 1,
              supplierUnitPrice: 80,
              supplierShippingCost: 0,
              supplierTaxAmount: 0
            }
          ];
        if (table === "journalLineDimension") return [];
        if (table === "purchaseOrderLine") return [];
        if (table === "externalIntegrationMapping as m")
          return config.accountMappings.map((m) => ({
            id: m.id,
            accountId: m.accountId,
            externalId: m.externalId,
            metadata: m.metadata,
            lastSyncedAt: m.lastSyncedAt,
            accountNumber: m.accountNumber,
            accountName: m.accountName
          }));
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

describe("QboBillSyncer.mapToRemote (FX currency wiring)", () => {
  it("pins CurrencyRef + ExchangeRate and replays transaction-currency amounts", async () => {
    const syncer = new QboBillSyncer({
      database: makeBillDb({
        purchaseInvoice: { currencyCode: "EUR", exchangeRate: 0.8 },
        journalLine: [
          {
            id: "jl-1",
            accountId: "acc-grir",
            amount: 100,
            description: "GR/IR Clearing",
            documentLineReference: null,
            accountClass: "Asset"
          },
          {
            id: "jl-2",
            accountId: "acc-ap",
            amount: 100, // Liability natural balance → debit-signed -100
            description: "Accounts Payable",
            documentLineReference: null,
            accountClass: "Liability"
          }
        ],
        accountDefault: { payablesAccount: "acc-ap" },
        accountMappings: [
          {
            id: "m-1",
            accountId: "acc-grir",
            externalId: "2125",
            metadata: null,
            lastSyncedAt: null,
            accountNumber: "2125",
            accountName: "GR/IR Clearing"
          }
        ]
      }),
      companyId: "company-1",
      provider: { id: "quickbooks" } as never,
      config: { enabled: true, direction: "two-way", owner: "accounting" },
      entityType: "bill"
    });

    const payload = await (
      syncer as unknown as {
        mapToRemote(local: Accounting.Bill): Promise<Qbo.Bill>;
      }
    ).mapToRemote(billFixture({ currencyCode: "EUR", exchangeRate: 0.8 }));

    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBe(1.25);
    // Base 100 @ rate 0.8 → 80 EUR to the mapped GR/IR account only (AP excluded).
    expect(payload.Line).toEqual([
      {
        Amount: 80,
        Description: "GR/IR Clearing",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: { value: "2125" } }
      }
    ]);
  });
});

describe("deriveCarbonBillStatus (pull status from Balance/TotalAmt/DueDate)", () => {
  const now = new Date("2026-07-09T00:00:00.000Z");

  it("derives Paid / Partially Paid / Overdue / Open", () => {
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 0,
        dueDate: "2026-07-01",
        now
      })
    ).toBe("Paid");
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 40,
        dueDate: "2026-08-01",
        now
      })
    ).toBe("Partially Paid");
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 100,
        dueDate: "2026-07-01",
        now
      })
    ).toBe("Overdue");
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: 100,
        dueDate: "2026-08-01",
        now
      })
    ).toBe("Open");
  });

  it("returns undefined when QBO reports no balance", () => {
    expect(
      deriveCarbonBillStatus({
        totalAmt: 100,
        balance: undefined,
        dueDate: undefined,
        now
      })
    ).toBeUndefined();
  });
});

describe("QBO inbound bill stored currency snapshots", () => {
  it("persists reciprocal rate before populating supplier document fields", async () => {
    const writes: Array<{ table: string; values: any }> = [];
    let header: any = {
      companyId: "company-1",
      createdBy: "user-1",
      exchangeRate: 1
    };
    const builder = (table: string, writing = false) => {
      let values: any;
      const filters: any[] = [];
      const b: any = {
        select: () => b,
        selectAll: () => b,
        where: (...args: any[]) => {
          filters.push(args);
          return b;
        },
        set: (v: any) => {
          values = v;
          return b;
        },
        values: (v: any) => {
          values = v;
          return b;
        },
        execute: async () => {
          if (writing) {
            writes.push({ table, values });
            if (table === "purchaseInvoice") header = { ...header, ...values };
          }
          return [];
        },
        executeTakeFirst: async () =>
          table === "company"
            ? { baseCurrencyCode: "USD", companyGroupId: "group-1" }
            : table === "externalIntegrationMapping"
              ? {
                  entityId:
                    filters.find((f) => f[0] === "externalId")?.[2] ===
                    "vendor-99"
                      ? "sup-1"
                      : "acc-grir"
                }
              : header,
        executeTakeFirstOrThrow: async () => header
      };
      return b;
    };
    const db = {
      selectFrom: (t: string) => builder(t),
      updateTable: (t: string) => builder(t, true),
      insertInto: (t: string) => builder(t, true),
      deleteFrom: (t: string) => builder(t, true)
    } as never;
    const syncer = new QboBillSyncer({
      database: db,
      companyId: "company-1",
      provider: { id: "quickbooks" } as never,
      config: { enabled: true, direction: "two-way", owner: "accounting" },
      entityType: "bill"
    }) as any;
    syncer.getLocalId = async () => "pi_1";
    const local = await syncer.mapToLocal({
      Id: "qb-1",
      VendorRef: { value: "vendor-99" },
      CurrencyRef: { value: "EUR" },
      ExchangeRate: 1.25,
      TotalAmt: 80,
      Balance: 80,
      TxnDate: "2026-09-07",
      Line: [
        {
          Amount: 80,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "2125" } }
        }
      ]
    });
    expect(local).toMatchObject({
      currencyCode: "EUR",
      exchangeRate: 0.8,
      totalAmount: 100
    });
    await syncer.upsertLocal(db, local, "qb-1");
    expect(
      writes.find((w) => w.table === "purchaseInvoice")?.values
    ).toMatchObject({ currencyCode: "EUR", exchangeRate: 0.8 });
    const rows = writes.find(
      (w) => w.table === "purchaseInvoiceLine" && w.values
    )?.values;
    expect(rows).toEqual([
      expect.objectContaining({
        supplierUnitPrice: 80,
        supplierTaxAmount: 0,
        exchangeRate: 0.8
      })
    ]);
    expect(rows[0]).not.toHaveProperty("unitPrice");
    expect(rows[0]).not.toHaveProperty("totalAmount");
    expect(rows[0]).not.toHaveProperty("supplierExtendedPrice");
  });
});

it("handles a malformed QBO account detail without AccountRef without losing the remaining bill", async () => {
  const database = {
    selectFrom: () => {
      const q: any = {
        select: () => q,
        where: () => q,
        execute: async () => [],
        executeTakeFirst: async () => ({ baseCurrencyCode: "USD" })
      };
      return q;
    }
  };
  const syncer = new QboBillSyncer({
    database: database as never,
    companyId: "company-1",
    provider: { id: "quickbooks" } as never,
    config: { enabled: true, direction: "two-way", owner: "accounting" },
    entityType: "bill"
  }) as any;
  await expect(
    syncer.mapToLocal({
      Id: "remote",
      VendorRef: { value: "vendor" },
      CurrencyRef: { value: "USD" },
      TotalAmt: 10,
      Balance: 10,
      Line: [
        {
          Id: "bad",
          Amount: 0,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {}
        },
        {
          Id: "good",
          Amount: 10,
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "cost" } }
        }
      ]
    })
  ).resolves.toMatchObject({
    totalAmount: 10,
    lines: expect.arrayContaining([expect.objectContaining({ id: "good" })])
  });
});

describe("buildQboBillPayloadLines (recoverable purchase tax)", () => {
  const purchaseCode = (
    Id: string,
    Name: string,
    rateId: string
  ): Qbo.TaxCode => ({
    Id,
    Name,
    Active: true,
    PurchaseTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: rateId } }] }
  });
  const catalog = (country: string): QboInvoiceTaxCatalog => ({
    country,
    taxCodes: [
      purchaseCode("20S", "20.0% S", "r20p"),
      purchaseCode("5R", "5.0% R", "r5p"),
      purchaseCode("12P", "GST/PST 12%", "r12p"),
      purchaseCode("EX", "Exempt", "r0ex"),
      purchaseCode("NOVAT", "No VAT", "r0n")
    ],
    taxRates: [
      { Id: "r20p", RateValue: 20 },
      { Id: "r5p", RateValue: 5 },
      { Id: "r12p", RateValue: 12 },
      { Id: "r0ex", RateValue: 0 },
      { Id: "r0n", RateValue: 0 }
    ]
  });
  const mapped = (taxCodeId: string, externalId: string, rate: number) => ({
    taxCodeId,
    direction: "purchase" as const,
    externalId,
    externalName: externalId,
    externalRate: rate
  });
  const mappings = buildTaxCodeMappingLookup([
    mapped("tc_std", "20S", 0.2),
    mapped("tc_red", "5R", 0.05),
    mapped("tc_bc", "12P", 0.12)
  ]);
  const accountRefs = new Map<string, Qbo.Ref>([
    ...BILL_ACCOUNT_REFS,
    ["acc-taxpaid", { value: "2201", name: "VAT Paid" }],
    ["acc-rc", { value: "2202", name: "Reverse Charge VAT" }]
  ]);
  type Costing = Parameters<typeof buildQboBillPayloadLines>[0]["costing"];
  const leg = (
    id: string,
    accountId: string,
    amount: number,
    tax: CostingLine["tax"]
  ): CostingLine => ({
    id,
    accountId,
    amount,
    description: accountId === "acc-grir" ? "GR/IR Clearing" : "Freight",
    tax
  });
  const std = { taxCodeId: "tc_std", taxPercent: 0.2 };
  const taxPaid = (id: string, amount: number): CostingLine => ({
    id,
    accountId: "acc-taxpaid",
    amount,
    description: "Tax Paid",
    taxLeg: true,
    tax: null
  });
  const ledger = (
    taxCodeId: string,
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
  const costing = (
    lines: CostingLine[],
    taxLedger: BillTaxLedgerRow[],
    documentTotal: number
  ): Costing => ({
    exchangeRate: 1,
    documentTotal,
    decimalPlaces: 2,
    lines,
    taxLedger
  });
  const gb = (value: Costing) =>
    buildQboBillPayloadLines({
      bill: billFixture({ currencyCode: "GBP" }),
      costing: value,
      accountRefsById: accountRefs,
      tax: { catalog: catalog("GB"), mappings }
    });
  const summary = (payload: ReturnType<typeof gb>) =>
    payload.Line.map((line) => [
      line.AccountBasedExpenseLineDetail?.AccountRef.value,
      line.Amount,
      line.AccountBasedExpenseLineDetail?.TaxCodeRef?.value
    ]);
  const total = (payload: ReturnType<typeof gb>) =>
    payload.Line.reduce((sum, line) => sum + line.Amount, 0) +
    (payload.TxnTaxDetail?.TotalTax ?? 0);

  // £1,000 at 20%, all recoverable, plus £50 of untaxed header freight in the
  // cost leg: cost 1,050, Tax Paid 200.
  const freightBill = () =>
    costing(
      [leg("jl-1", "acc-grir", 1050, std), taxPaid("jl-2", 200)],
      [ledger("tc_std", 0.2, 200, 200)],
      1250
    );

  it("sends a GB bill with header freight: the net at the mapped code, the freight non-taxable", () => {
    const payload = gb(freightBill());
    expect(payload.GlobalTaxCalculation).toBe("TaxExcluded");
    expect(payload.Line).toEqual([
      {
        Amount: 1000,
        Description: "GR/IR Clearing",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "2125", name: "GR/IR Clearing" },
          TaxCodeRef: { value: "20S" }
        }
      },
      {
        Amount: 50,
        Description: "GR/IR Clearing",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "2125", name: "GR/IR Clearing" },
          TaxCodeRef: { value: "NOVAT" }
        }
      }
    ]);
    expect(payload.TxnTaxDetail).toEqual({
      TotalTax: 200,
      TaxLine: [
        {
          Amount: 200,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: "r20p" },
            NetAmountTaxable: 1000,
            PercentBased: true,
            TaxPercent: 20
          }
        }
      ]
    });
    // The Tax Paid leg is not a line: QuickBooks books it from the codes, and
    // the bill total is unchanged.
    expect(total(payload)).toBe(1250);
  });

  it("sends a large bill whose recoverable share does not terminate (GST 5% of 12%)", () => {
    // $29,900.05 at 12%: GST 5% recoverable, PST 7% not. The share is 5/12.
    const payload = gb(
      costing(
        [
          leg("jl-1", "acc-grir", 31993.05583, {
            taxCodeId: "tc_bc",
            taxPercent: 0.12
          }),
          taxPaid("jl-2", 1495.00417)
        ],
        [
          ledger("tc_bc", 0.05, 1495.00417, 1495.00417),
          ledger("tc_bc", 0.07, 2093.00583, 0)
        ],
        33488.06
      )
    );
    expect(summary(payload)).toEqual([
      ["2125", 12458.33, "12P"],
      ["2125", 19534.73, "NOVAT"]
    ]);
    expect(payload.TxnTaxDetail?.TotalTax).toBe(1495);
    expect(total(payload)).toBeCloseTo(33488.06, 6);
  });

  it("splits a 50% recoverable bill into the recoverable net and a non-taxable rest", () => {
    // £1,000 net at 20%, half recoverable: cost 1,100, Tax Paid 100.
    const payload = gb(
      costing(
        [leg("jl-1", "acc-grir", 1100, std), taxPaid("jl-2", 100)],
        [ledger("tc_std", 0.2, 200, 100)],
        1200
      )
    );
    expect(summary(payload)).toEqual([
      ["2125", 500, "20S"],
      ["2125", 600, "NOVAT"]
    ]);
    expect(payload.TxnTaxDetail?.TotalTax).toBe(100);
  });

  it("sends a bill spanning two codes, each code's tax on its own legs", () => {
    // £1,000 at 20% and £400 at 5%, both recoverable, plus £70 freight
    // weighted on the gross lines.
    const payload = gb(
      costing(
        [
          leg("jl-1", "acc-grir", 1051.85185, std),
          taxPaid("jl-2", 200),
          leg("jl-3", "acc-ppv", 418.14815, {
            taxCodeId: "tc_red",
            taxPercent: 0.05
          }),
          taxPaid("jl-4", 20)
        ],
        [ledger("tc_std", 0.2, 200, 200), ledger("tc_red", 0.05, 20, 20)],
        1690
      )
    );
    expect(summary(payload)).toEqual([
      ["2125", 1000, "20S"],
      ["2125", 51.85, "NOVAT"],
      ["5210", 400, "5R"],
      ["5210", 18.15, "NOVAT"]
    ]);
    expect(
      payload.TxnTaxDetail?.TaxLine.map((line) => [
        line.TaxLineDetail.TaxRateRef.value,
        line.Amount,
        line.TaxLineDetail.NetAmountTaxable
      ])
    ).toEqual([
      ["r20p", 200, 1000],
      ["r5p", 20, 400]
    ]);
    expect(total(payload)).toBeCloseTo(1690, 6);
  });

  it("sends a reverse-charge bill tax-neutral: every leg an account line, no tax fields", () => {
    // £1,000 from an EU supplier at a 20% reverse charge, all recoverable:
    // Dr Tax Paid 200, Cr Reverse Charge Tax 200, AP stays at the net.
    const reverseCharge = costing(
      [
        leg("jl-1", "acc-grir", 1000, std),
        taxPaid("jl-2", 200),
        {
          id: "jl-3",
          accountId: "acc-rc",
          amount: -200,
          description: "Reverse Charge Tax",
          reverseChargeLeg: true,
          tax: null
        }
      ],
      [ledger("tc_std", 0.2, 200, 200)],
      1000
    );
    const neutral = {
      Line: buildQboBillLines({
        bill: billFixture(),
        costingLines: reverseCharge.lines,
        accountRefsById: accountRefs
      })
    };
    expect(gb(reverseCharge)).toEqual(neutral);
    expect(
      buildQboBillPayloadLines({
        bill: billFixture(),
        costing: reverseCharge,
        accountRefsById: accountRefs,
        tax: null
      })
    ).toEqual(neutral);
    expect(neutral.Line.map((line) => line.Amount)).toEqual([1000, 200, -200]);
  });

  it("keeps a US bill as today: the Tax Paid leg replays as an account line, with no tax fields", () => {
    const payload = buildQboBillPayloadLines({
      bill: billFixture(),
      costing: freightBill(),
      accountRefsById: accountRefs,
      tax: { catalog: catalog("US"), mappings: new Map() }
    });
    expect(payload).toEqual({
      Line: buildQboBillLines({
        bill: billFixture(),
        costingLines: freightBill().lines,
        accountRefsById: accountRefs
      })
    });
    expect(payload.Line.map((line) => line.Amount)).toEqual([1050, 200]);
  });

  it("sends a bill with no tax code and no recoverable tax exactly as before", () => {
    // A bill posted before tax codes: legacy tax folded into cost, no code.
    const lines = [
      leg("jl-1", "acc-grir", 1200, { taxCodeId: null, taxPercent: 0.2 }),
      leg("jl-2", "acc-ppv", 50, null)
    ];
    expect(
      buildQboBillPayloadLines({
        bill: billFixture(),
        costing: costing(lines, [], 1250),
        accountRefsById: accountRefs,
        tax: null
      })
    ).toEqual({
      Line: buildQboBillLines({
        bill: billFixture(),
        costingLines: lines,
        accountRefsById: accountRefs
      })
    });
  });

  it("refuses a GB bill whose code's legs cannot absorb its recoverable net", () => {
    // The only leg tied to tc_std is 500, but its tax is charged on 1,000.
    expect(() =>
      gb(
        costing(
          [
            leg("jl-1", "acc-grir", 1000, null),
            leg("jl-2", "acc-ppv", 500, std),
            taxPaid("jl-3", 200)
          ],
          [ledger("tc_std", 0.2, 200, 200)],
          1700
        )
      )
    ).toThrow(/UNMAPPED_TAX_CODES/);
  });

  it("refuses a GB bill whose code has no purchase mapping", () => {
    try {
      buildQboBillPayloadLines({
        bill: billFixture(),
        costing: freightBill(),
        accountRefsById: accountRefs,
        tax: { catalog: catalog("GB"), mappings: new Map() }
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as JournalEntrySyncError).failure).toMatchObject({
        errorCode: "UNMAPPED_TAX_CODES",
        warning: true,
        metadata: { taxCodeId: "tc_std", direction: "purchase" }
      });
    }
  });

  it("sends a GB bill's zero-rated line at its mapped code, so its net reaches the return", () => {
    const zeroRated = buildTaxCodeMappingLookup([
      mapped("tc_zero", "EX", 0),
      mapped("tc_blocked", "20S", 0.2)
    ]);
    const payload = buildQboBillPayloadLines({
      bill: billFixture({ currencyCode: "GBP" }),
      costing: costing(
        [
          {
            id: "jl-1",
            accountId: "acc-grir",
            amount: 1000,
            description: "Books",
            tax: { taxCodeId: "tc_zero", taxPercent: 0 }
          },
          {
            // 20% folded into cost (none recoverable): the non-taxable code.
            id: "jl-2",
            accountId: "acc-ppv",
            amount: 600,
            description: "Entertainment",
            tax: { taxCodeId: "tc_blocked", taxPercent: 0.2 }
          }
        ],
        [ledger("tc_blocked", 0.2, 100, 0)],
        1600
      ),
      accountRefsById: accountRefs,
      tax: { catalog: catalog("GB"), mappings: zeroRated }
    });

    expect(
      payload.Line.map((line) => [
        line.Amount,
        line.AccountBasedExpenseLineDetail?.TaxCodeRef?.value
      ])
    ).toEqual([
      [1000, "EX"],
      [600, "NOVAT"]
    ]);
    expect(payload.GlobalTaxCalculation).toBe("TaxExcluded");
    expect(payload.TxnTaxDetail).toEqual({
      TotalTax: 0,
      TaxLine: [
        {
          Amount: 0,
          DetailType: "TaxLineDetail",
          TaxLineDetail: {
            TaxRateRef: { value: "r0ex" },
            NetAmountTaxable: 1000,
            PercentBased: true,
            TaxPercent: 0
          }
        }
      ]
    });
  });

  it("refuses a GB zero-rated line whose code has no purchase mapping", () => {
    expect(() =>
      gb(
        costing(
          [
            {
              id: "jl-1",
              accountId: "acc-grir",
              amount: 1000,
              description: "Books",
              tax: { taxCodeId: "tc_zero", taxPercent: 0 }
            }
          ],
          [],
          1000
        )
      )
    ).toThrow(/UNMAPPED_TAX_CODES/);
  });
});
