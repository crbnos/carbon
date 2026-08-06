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
        if (table === "purchaseInvoice") return config.purchaseInvoice;
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
        purchaseInvoice: { currencyCode: "EUR", exchangeRate: 2 },
        journalLine: [
          {
            id: "jl-1",
            accountId: "acc-grir",
            amount: 300,
            description: "GR/IR Clearing",
            documentLineReference: null,
            accountClass: "Asset"
          },
          {
            id: "jl-2",
            accountId: "acc-ap",
            amount: 300, // Liability natural balance → debit-signed -300
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
    ).mapToRemote(billFixture({ currencyCode: "EUR", exchangeRate: 2 }));

    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBe(2);
    // Base 300 @ rate 2 → 150 EUR to the mapped GR/IR account only (AP excluded).
    expect(payload.Line).toEqual([
      {
        Amount: 150,
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
