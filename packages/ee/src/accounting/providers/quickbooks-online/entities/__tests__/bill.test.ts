import { describe, expect, it } from "vitest";
import type { CostingLine } from "../../../../core/document-costing";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import type { Qbo } from "../../models";
import {
  buildQboBillLines,
  deriveCarbonBillStatus,
  QboBillSyncer
} from "../bill";
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
