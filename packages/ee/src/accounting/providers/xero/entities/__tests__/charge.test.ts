import { describe, expect, it, vi } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import {
  mapCardTransactionToXeroBankTransaction,
  type XeroCardCharge,
  type XeroChargeCosting,
  type XeroChargePostingJournalLine,
  XeroChargeSyncer
} from "../charge";

/**
 * Xero card charges are spend/receive-money bank transactions on the card
 * account: an account-costed replay of the posted Card Transaction journal
 * (AccountCode = the journal's mapped account, TaxType NONE), direction on
 * Type (SPEND for a Charge, RECEIVE for a Credit), transaction-currency
 * amounts with CurrencyRate pinned for foreign charges.
 */

const { linked } = vi.hoisted(() => ({ linked: [] as unknown[] }));
vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    cb: (tx: unknown) => Promise<unknown>
  ) => {
    const b = {
      values: (row: unknown) => {
        linked.push(row);
        return b;
      },
      onConflict: () => b,
      execute: async () => []
    };
    return cb({ insertInto: () => b });
  }
}));

const charge = (overrides: Partial<XeroCardCharge> = {}): XeroCardCharge => ({
  id: "ct_1",
  companyId: "company-1",
  cardTransactionId: "CARD-2026-09-0001",
  type: "Charge",
  status: "Posted",
  supplierId: "sup_delta",
  supplierExternalId: "contact-uuid",
  merchantName: "Delta Air Lines",
  memo: "SFO→ORD for the Apollo kickoff",
  updatedAt: null,
  ...overrides
});

// The posted journal's coded lines, card-liability line already excluded.
const lines: XeroChargePostingJournalLine[] = [
  {
    id: "jl-travel",
    accountId: "acct_travel",
    amount: 431.68,
    description: "Airfare",
    dimensions: [{ dimensionId: "dim_cc", valueId: "cc_apollo" }]
  }
];

const costing = (
  overrides: Partial<XeroChargeCosting> = {}
): XeroChargeCosting => ({
  lines,
  documentTotal: 431.68,
  decimalPlaces: 2,
  baseCurrencyCode: "USD",
  postingDate: "2026-09-08",
  transactionDate: "2026-09-07",
  currencyCode: "USD",
  exchangeRate: 1,
  cardAccountId: "acct_ramp",
  ...overrides
});

const codes = new Map([
  ["acct_travel", "6100"],
  ["acct_ramp", "2100"]
]);

const base = {
  vendorRemoteId: "contact-uuid",
  accountCodesById: codes
};

const TRACKING_CATEGORY_ID = "11111111-1111-1111-1111-111111111111";

describe("mapCardTransactionToXeroBankTransaction", () => {
  it("builds a SPEND on the card account that Xero posts exactly like Carbon's journal", () => {
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge(),
      costing: costing(),
      ...base
    });
    expect(payload).toEqual({
      Type: "SPEND",
      Contact: { ContactID: "contact-uuid" },
      BankAccount: { Code: "2100" },
      Date: "2026-09-07",
      Reference: "CARD-2026-09-0001",
      Status: "AUTHORISED",
      LineAmountTypes: "NoTax",
      CurrencyCode: "USD",
      CurrencyRate: undefined,
      LineItems: [
        {
          Description: "Airfare",
          Quantity: 1,
          UnitAmount: 431.68,
          AccountCode: "6100",
          TaxType: "NONE"
        }
      ]
    });
  });

  it("builds a RECEIVE with positive line amounts for a Credit (merchant refund)", () => {
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge({ type: "Credit" }),
      costing: costing({
        lines: [{ ...lines[0]!, amount: -431.68 }],
        documentTotal: -431.68
      }),
      ...base
    });
    expect(payload.Type).toBe("RECEIVE");
    expect(payload.BankAccount).toEqual({ Code: "2100" });
    expect(payload.LineItems).toEqual([
      {
        Description: "Airfare",
        Quantity: 1,
        UnitAmount: 431.68,
        AccountCode: "6100",
        TaxType: "NONE"
      }
    ]);
  });

  it("attaches tracking from the dimension slots (cost center → tracking option)", () => {
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge(),
      costing: costing(),
      ...base,
      dimensions: {
        slots: [
          { dimensionId: "dim_cc", target: `tracking:${TRACKING_CATEGORY_ID}` }
        ],
        optionIdsByValue: new Map([["dim_cc:cc_apollo", "option-uuid"]])
      }
    });
    expect(payload.LineItems[0]?.Tracking).toEqual([
      {
        TrackingCategoryID: TRACKING_CATEGORY_ID,
        TrackingOptionID: "option-uuid"
      }
    ]);
  });

  it("drops a slotted dimension whose tracking option is not mapped", () => {
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge(),
      costing: costing(),
      ...base,
      dimensions: {
        slots: [
          { dimensionId: "dim_cc", target: `tracking:${TRACKING_CATEGORY_ID}` }
        ],
        optionIdsByValue: new Map()
      }
    });
    expect(payload.LineItems[0]?.Tracking).toBeUndefined();
  });

  it("falls back to the card memo when a line has no description", () => {
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge(),
      costing: costing({ lines: [{ ...lines[0]!, description: null }] }),
      ...base
    });
    expect(payload.LineItems[0]?.Description).toBe(
      "SFO→ORD for the Apollo kickoff"
    );
  });

  it("converts a foreign charge to its transaction currency and pins CurrencyRate", () => {
    // A CAD charge: base USD lines × 1.25 CAD per USD.
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge(),
      costing: costing({
        lines: [{ ...lines[0]!, amount: 345.34 }],
        documentTotal: 431.68,
        currencyCode: "CAD",
        exchangeRate: 1.25
      }),
      ...base
    });
    expect(payload.CurrencyCode).toBe("CAD");
    expect(payload.CurrencyRate).toBe(1.25);
    expect(payload.LineItems.map((line) => line.UnitAmount)).toEqual([431.68]);
  });

  it("pins a foreign identity rate instead of letting Xero choose a rate", () => {
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge(),
      costing: costing({ currencyCode: "CAD", exchangeRate: 1 }),
      ...base
    });
    expect(payload.CurrencyRate).toBe(1);
  });

  it("fails as the UNMAPPED_ACCOUNTS Warning when a line account is unmapped", () => {
    try {
      mapCardTransactionToXeroBankTransaction({
        charge: charge(),
        costing: costing(),
        ...base,
        accountCodesById: new Map([["acct_ramp", "2100"]])
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JournalEntrySyncError);
      expect((err as JournalEntrySyncError).failure).toMatchObject({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        metadata: {
          cardTransactionId: "ct_1",
          unmappedAccountIds: ["acct_travel"],
          lineIdsWithoutAccount: []
        }
      });
    }
  });

  it("fails as the UNMAPPED_ACCOUNTS Warning when the card-liability account is unmapped", () => {
    try {
      mapCardTransactionToXeroBankTransaction({
        charge: charge(),
        costing: costing(),
        ...base,
        accountCodesById: new Map([["acct_travel", "6100"]])
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as JournalEntrySyncError).failure).toMatchObject({
        errorCode: "UNMAPPED_ACCOUNTS",
        metadata: { unmappedAccountIds: ["acct_ramp"] }
      });
    }
  });

  it("reports posting lines that carry no account", () => {
    try {
      mapCardTransactionToXeroBankTransaction({
        charge: charge(),
        costing: costing({ lines: [{ ...lines[0]!, accountId: null }] }),
        ...base
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as JournalEntrySyncError).failure).toMatchObject({
        errorCode: "UNMAPPED_ACCOUNTS",
        metadata: { lineIdsWithoutAccount: ["jl-travel"] }
      });
    }
  });

  it("fails as a Warning when there is no posted journal to replay", () => {
    expect(() =>
      mapCardTransactionToXeroBankTransaction({
        charge: charge(),
        costing: costing({ lines: [] }),
        ...base
      })
    ).toThrow(JournalEntrySyncError);
  });

  it("refuses sub-cent principal instead of letting Xero round it", () => {
    // A three-decimal currency (KWD) posts a legitimate 431.681 that Xero's
    // two-decimal monetary boundary cannot carry.
    expect(() =>
      mapCardTransactionToXeroBankTransaction({
        charge: charge(),
        costing: costing({
          lines: [{ ...lines[0]!, amount: 431.681 }],
          documentTotal: 431.681,
          decimalPlaces: 3,
          currencyCode: "KWD",
          baseCurrencyCode: "KWD"
        }),
        ...base
      })
    ).toThrow(/Xero.*precision|Xero.*decimal/i);
  });
});

function makeSyncer(args: {
  request?: (method: string, url: string, init?: RequestInit) => unknown;
  mapping?: unknown;
  local?: Partial<XeroCardCharge>;
}) {
  linked.length = 0;
  const syncer = new XeroChargeSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: { id: "xero", request: args.request ?? vi.fn() } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "charge"
  });
  if (args.local) {
    vi.spyOn(syncer, "fetchLocal").mockResolvedValue(charge(args.local));
  }
  (syncer as unknown as Record<string, unknown>).mappingService = {
    getByEntity: async () => args.mapping ?? null
  };
  return syncer as unknown as XeroChargeSyncer & {
    shouldSync(context: {
      direction: "push" | "pull";
      localEntity?: XeroCardCharge;
      isFirstSync: boolean;
      entityId: string;
    }): boolean | string;
    upsertRemote(data: unknown, localId: string): Promise<string>;
  };
}

describe("XeroChargeSyncer.shouldSync (mirrors isChargeBackedCardTransaction)", () => {
  const push = (local: XeroCardCharge) =>
    makeSyncer({}).shouldSync({
      direction: "push",
      localEntity: local,
      isFirstSync: true,
      entityId: local.id
    });

  it("pushes a Posted Charge with a supplier", () => {
    expect(push(charge())).toBe(true);
  });

  it("pushes a Credit — Xero represents a merchant refund as a RECEIVE", () => {
    expect(push(charge({ type: "Credit" }))).toBe(true);
  });

  it("skips a Draft card transaction", () => {
    expect(push(charge({ status: "Draft" }))).toContain("must be posted");
  });

  it("skips money movements (Payment/Cashback/Repayment) — they stay journal entries", () => {
    expect(push(charge({ type: "Payment" }))).toContain("money movement");
  });

  it("skips a charge with no merchant supplier", () => {
    expect(push(charge({ supplierId: null }))).toContain(
      "no merchant supplier"
    );
  });

  it("refuses pulls", () => {
    expect(
      makeSyncer({}).shouldSync({
        direction: "pull",
        isFirstSync: true,
        entityId: "bt-1"
      })
    ).toContain("push-only");
  });
});

describe("XeroChargeSyncer transport", () => {
  it("creates with PUT /BankTransactions (unit precision opted in)", async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const syncer = makeSyncer({
      request: async (method, url, init) => {
        requests.push({
          method,
          url,
          body: JSON.parse(String(init?.body))
        });
        return {
          error: false,
          data: { BankTransactions: [{ BankTransactionID: "bt-remote" }] }
        };
      }
    });
    const payload = mapCardTransactionToXeroBankTransaction({
      charge: charge(),
      costing: costing(),
      ...base
    });

    await expect(syncer.upsertRemote(payload, "ct_1")).resolves.toBe(
      "bt-remote"
    );
    expect(requests).toEqual([
      {
        method: "PUT",
        url: "/BankTransactions?unitdp=4",
        body: { BankTransactions: [JSON.parse(JSON.stringify(payload))] }
      }
    ]);
  });

  it("deletes a mapped Voided charge with POST Status DELETED and tombstones the mapping", async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const syncer = makeSyncer({
      request: async (method, url, init) => {
        requests.push({
          method,
          url,
          body: JSON.parse(String(init?.body))
        });
        return { error: false, data: { BankTransactions: [] } };
      },
      mapping: { externalId: "bt-remote", metadata: { retained: true } },
      local: { status: "Voided" }
    });

    expect(await syncer.pushToAccounting("ct_1")).toMatchObject({
      status: "success",
      action: "deleted",
      remoteId: "bt-remote"
    });
    expect(requests).toEqual([
      {
        method: "POST",
        url: "/BankTransactions",
        body: {
          BankTransactions: [
            { BankTransactionID: "bt-remote", Status: "DELETED" }
          ]
        }
      }
    ]);
    expect(linked[0]).toMatchObject({
      entityId: "ct_1",
      externalId: "bt-remote",
      metadata: { retained: true, voided: true }
    });
  });

  it("skips repeat deletes after the durable marker", async () => {
    const request = vi.fn();
    const syncer = makeSyncer({
      request,
      mapping: { externalId: "bt-remote", metadata: { voided: true } },
      local: { status: "Voided" }
    });

    expect(await syncer.pushToAccounting("ct_1")).toMatchObject({
      status: "success",
      action: "deleted"
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps a pushed Posted charge immutable (idempotent skip)", async () => {
    const request = vi.fn();
    const syncer = makeSyncer({
      request,
      mapping: { externalId: "bt-remote" },
      local: { status: "Posted" }
    });

    expect(await syncer.pushToAccounting("ct_1")).toMatchObject({
      status: "skipped",
      remoteId: "bt-remote"
    });
    expect(request).not.toHaveBeenCalled();
  });
});
