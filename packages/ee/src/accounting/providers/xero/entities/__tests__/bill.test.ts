import { describe, expect, it } from "vitest";
import type { CostingLine } from "../../../../core/document-costing";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import type { Xero } from "../../models";
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
          return config.accountMappings;
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

function makeBillSyncer(db: never, remoteId: string | null) {
  const syncer = new BillSyncer({
    database: db,
    companyId: "company-1",
    provider: { id: "xero", settings: {} } as never,
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
  const fxDb = () =>
    makeBillDb({
      purchaseInvoice: { currencyCode: "EUR", exchangeRate: 2 },
      journalLine: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300,
          description: "GR/IR Clearing",
          documentLineReference: null,
          accountClass: "Asset"
        },
        {
          id: "jl-2",
          accountId: "acct_ap",
          amount: 300,
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
      bill({ currencyCode: "EUR", exchangeRate: 2 })
    );

    expect(payload.CurrencyCode).toBe("EUR");
    expect(payload.CurrencyRate).toBe(2);
    expect(payload.LineItems).toEqual([
      {
        Description: "GR/IR Clearing",
        LineAmount: 150,
        AccountCode: "2125",
        TaxType: "NONE"
      }
    ]);
    // Tax-neutral replay: no totals sent (Xero computes from NONE-taxed lines).
    expect(payload.SubTotal).toBeUndefined();
    expect(payload.TotalTax).toBeUndefined();
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
