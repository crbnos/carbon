import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { Qbo } from "../../models";
import {
  mapCardTransactionToQboPurchase,
  type QboCardCharge,
  type QboChargeCosting,
  type QboChargeCostingLine,
  QboChargeSyncer
} from "../charge";
import { QBO_DOC_NUMBER_MAX_LENGTH } from "../shared";

const charge = (overrides: Partial<QboCardCharge> = {}): QboCardCharge => ({
  id: "ct_1",
  companyId: "company-1",
  cardTransactionId: "CARD-2026-09-0001",
  type: "Charge",
  status: "Posted",
  supplierId: "sup_delta",
  supplierExternalId: "vendor-99",
  merchantName: "Delta Air Lines",
  memo: "SFO→ORD for the Apollo kickoff",
  updatedAt: null,
  ...overrides
});

// The posted journal's coded lines, card-liability line already excluded.
const lines: QboChargeCostingLine[] = [
  {
    id: "jl-travel",
    accountId: "acct_travel",
    amount: 431.68,
    description: "Airfare",
    dimensions: [
      { dimensionId: "dim_cc", valueId: "cc_apollo" },
      { dimensionId: "dim_loc", valueId: "loc_sfo" }
    ]
  }
];

const costing = (
  overrides: Partial<QboChargeCosting> = {}
): QboChargeCosting => ({
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

// Carbon account.id -> QBO AccountRef (mapping externalId = QBO Account.Id)
const ACCOUNT_REFS: ReadonlyMap<string, Qbo.Ref> = new Map([
  ["acct_travel", { value: "61", name: "Travel" }],
  ["acct_ramp", { value: "21", name: "Ramp Card" }]
]);

const base = {
  vendorRemoteId: "vendor-99",
  accountRefsById: ACCOUNT_REFS
};

describe("mapCardTransactionToQboPurchase", () => {
  it("builds a CreditCard Purchase QBO posts exactly like Carbon's journal (debit lines, credit the card)", () => {
    const payload = mapCardTransactionToQboPurchase({
      charge: charge(),
      costing: costing(),
      ...base
    });
    expect(payload).toEqual({
      PaymentType: "CreditCard",
      AccountRef: { value: "21", name: "Ramp Card" },
      EntityRef: { value: "vendor-99", type: "Vendor" },
      DocNumber: "CARD-2026-09-0001",
      PrivateNote: "SFO→ORD for the Apollo kickoff",
      TxnDate: "2026-09-08",
      Line: [
        {
          Amount: 431.68,
          Description: "Airfare",
          DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: "61", name: "Travel" }
          }
        }
      ]
    });
    // A charge is the plain case: no Credit flag, no FX, no department.
    expect("Credit" in payload).toBe(false);
    expect("CurrencyRef" in payload).toBe(false);
    expect("DepartmentRef" in payload).toBe(false);
  });

  it("sends a merchant refund as Credit: true with the refund's positive magnitude", () => {
    const payload = mapCardTransactionToQboPurchase({
      charge: charge({ type: "Credit" }),
      // A Credit's journal lines come out credit-signed (negative).
      costing: costing({
        lines: [{ ...lines[0]!, amount: -431.68 }],
        documentTotal: -431.68
      }),
      ...base
    });
    expect(payload.Credit).toBe(true);
    expect(payload.PaymentType).toBe("CreditCard");
    expect(payload.Line.map((line) => line.Amount)).toEqual([431.68]);
  });

  it("carries a class slot on the line and a department slot on the transaction", () => {
    const payload = mapCardTransactionToQboPurchase({
      charge: charge(),
      costing: costing(),
      ...base,
      dimensions: {
        slots: [
          { dimensionId: "dim_cc", target: "class" },
          { dimensionId: "dim_loc", target: "department" }
        ],
        refsByValue: new Map([
          ["dim_cc:cc_apollo", { value: "500", name: "Apollo" }],
          ["dim_loc:loc_sfo", { value: "300", name: "San Francisco" }]
        ])
      }
    });
    expect(payload.Line[0]?.AccountBasedExpenseLineDetail).toEqual({
      AccountRef: { value: "61", name: "Travel" },
      ClassRef: { value: "500", name: "Apollo" }
    });
    expect(payload.DepartmentRef).toEqual({
      value: "300",
      name: "San Francisco"
    });
  });

  it("omits refs for unmapped values (drop path) and for unslotted dimensions", () => {
    const payload = mapCardTransactionToQboPurchase({
      charge: charge(),
      costing: costing(),
      ...base,
      dimensions: {
        // Only the cost center is slotted, and its value is unmapped
        slots: [{ dimensionId: "dim_cc", target: "class" }],
        refsByValue: new Map([["dim_loc:loc_sfo", { value: "300" }]])
      }
    });
    expect(
      payload.Line[0]?.AccountBasedExpenseLineDetail?.ClassRef
    ).toBeUndefined();
    expect(payload.DepartmentRef).toBeUndefined();
  });

  it("falls back to the card memo when a line has no description", () => {
    const payload = mapCardTransactionToQboPurchase({
      charge: charge(),
      costing: costing({ lines: [{ ...lines[0]!, description: null }] }),
      ...base
    });
    expect(payload.Line[0]?.Description).toBe("SFO→ORD for the Apollo kickoff");
  });

  it("converts a foreign charge to its transaction currency and pins the reciprocal QBO rate", () => {
    // A CAD charge: base USD lines × 1.25 CAD per USD; QBO quotes USD per CAD.
    const payload = mapCardTransactionToQboPurchase({
      charge: charge(),
      costing: costing({
        lines: [{ ...lines[0]!, amount: 345.34 }],
        documentTotal: 431.68,
        currencyCode: "CAD",
        exchangeRate: 1.25
      }),
      ...base
    });
    expect(payload.CurrencyRef).toEqual({ value: "CAD" });
    expect(payload.ExchangeRate).toBe(1 / 1.25);
    expect(payload.Line.map((line) => line.Amount)).toEqual([431.68]);
  });

  it("moves an over-long readable id to PrivateNote under QBO's 21-char DocNumber cap", () => {
    const longId = "CARD-2026-09-000000000001";
    expect(longId.length).toBeGreaterThan(QBO_DOC_NUMBER_MAX_LENGTH);
    const payload = mapCardTransactionToQboPurchase({
      charge: charge({ cardTransactionId: longId }),
      costing: costing(),
      ...base
    });
    expect(payload.DocNumber).toBeUndefined();
    expect(payload.PrivateNote).toBe(
      `Carbon ${longId} | SFO→ORD for the Apollo kickoff`
    );
  });

  it("fails as the UNMAPPED_ACCOUNTS Warning when a line account is unmapped", () => {
    const attempt = () =>
      mapCardTransactionToQboPurchase({
        charge: charge(),
        costing: costing(),
        ...base,
        accountRefsById: new Map([["acct_ramp", { value: "21" }]])
      });
    expect(attempt).toThrow(JournalEntrySyncError);
    try {
      attempt();
    } catch (err) {
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
      mapCardTransactionToQboPurchase({
        charge: charge(),
        costing: costing(),
        ...base,
        accountRefsById: new Map([["acct_travel", { value: "61" }]])
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JournalEntrySyncError);
      expect((err as JournalEntrySyncError).failure).toMatchObject({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        metadata: { unmappedAccountIds: ["acct_ramp"] }
      });
    }
  });

  it("fails as a Warning when there is no posted journal to replay", () => {
    try {
      mapCardTransactionToQboPurchase({
        charge: charge(),
        costing: costing({ lines: [] }),
        ...base
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JournalEntrySyncError);
      expect((err as JournalEntrySyncError).failure).toMatchObject({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        metadata: { cardTransactionId: "ct_1" }
      });
    }
  });
});

// ── shouldSync mirrors isChargeBackedCardTransaction ──────────────────────────

describe("QboChargeSyncer.shouldSync", () => {
  function makeSyncer() {
    const syncer = new QboChargeSyncer({
      database: {} as never,
      companyId: "company-1",
      provider: { id: "quickbooks" } as never,
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      },
      entityType: "charge"
    });
    return syncer as unknown as {
      shouldSync(context: {
        direction: "push" | "pull";
        localEntity?: QboCardCharge;
        isFirstSync: boolean;
        entityId: string;
      }): boolean | string;
    };
  }

  const push = (local: QboCardCharge, isFirstSync = true) =>
    makeSyncer().shouldSync({
      direction: "push",
      localEntity: local,
      isFirstSync,
      entityId: local.id
    });

  it("pushes a Posted Charge with a merchant supplier", () => {
    expect(push(charge())).toBe(true);
  });

  it("pushes a Posted Credit too — QBO represents a refund natively", () => {
    expect(push(charge({ type: "Credit" }))).toBe(true);
  });

  it("skips money movements (Payment / Cashback / Repayment) — they stay journal entries", () => {
    for (const type of ["Payment", "Cashback", "Repayment"] as const) {
      const result = push(charge({ type }));
      expect(typeof result).toBe("string");
      expect(result).toContain("journal entry");
    }
  });

  it("skips a charge with no merchant supplier — it stays a journal entry", () => {
    const result = push(charge({ supplierId: null, supplierExternalId: null }));
    expect(result).toContain("no merchant supplier");
  });

  it("skips an unposted charge", () => {
    expect(push(charge({ status: "Draft" }))).toContain("must be posted");
  });

  it("skips a void truthfully (not yet propagated) rather than reporting success", () => {
    expect(push(charge({ status: "Voided" }), true)).toContain(
      "nothing to push"
    );
    expect(push(charge({ status: "Voided" }), false)).toContain(
      "not yet propagated"
    );
  });

  it("is push-only", () => {
    const result = makeSyncer().shouldSync({
      direction: "pull",
      isFirstSync: true,
      entityId: "purchase-1"
    });
    expect(result).toContain("push-only");
  });
});
