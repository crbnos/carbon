import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import {
  type CardCharge,
  type ChargeCosting,
  type ChargePostingJournalLine,
  mapCardTransactionToRilletCharge
} from "../charge";
import { toRilletExchangeRate } from "../shared";

const charge = (overrides: Partial<CardCharge> = {}): CardCharge => ({
  id: "ct_1",
  companyId: "company-1",
  cardTransactionId: "CARD-2026-09-0001",
  type: "Charge",
  status: "Posted",
  supplierId: "sup_delta",
  supplierExternalId: "vendor-uuid",
  merchantName: "Delta Air Lines",
  memo: "SFO→ORD for the Apollo kickoff",
  updatedAt: null,
  ...overrides
});

// The posted journal's coded lines, card-liability line already excluded.
const lines: ChargePostingJournalLine[] = [
  {
    id: "jl-travel",
    accountId: "acct_travel",
    amount: 431.68,
    description: "Airfare",
    dimensions: [{ dimensionId: "dim_cc", valueId: "cc_apollo" }]
  }
];

const costing = (overrides: Partial<ChargeCosting> = {}): ChargeCosting => ({
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
  vendorRemoteId: "vendor-uuid",
  accountCodesById: codes,
  subsidiaryId: null,
  companyId: "company-1"
};

describe("mapCardTransactionToRilletCharge", () => {
  it("builds a charge Rillet posts exactly like Carbon's journal (debit lines, credit the card)", () => {
    const payload = mapCardTransactionToRilletCharge({
      charge: charge(),
      costing: costing(),
      ...base
    });
    expect(payload).toEqual({
      vendor_id: "vendor-uuid",
      items: [
        {
          account_code: "6100",
          amount: { amount: "431.68", currency: "USD" },
          description: "Airfare"
        }
      ],
      charge_date: "2026-09-07",
      impact_date: "2026-09-08",
      credit_card_account_code: "2100",
      exchange_rate: undefined,
      external_references: [
        { type: "carbon", id: "ct_1" },
        { type: "carbon-company", id: "company-1" }
      ]
    });
  });

  it("carries the cost center (project) as a Rillet Field on the item", () => {
    const payload = mapCardTransactionToRilletCharge({
      charge: charge(),
      costing: costing(),
      ...base,
      dimensions: {
        fieldIdByDimensionId: new Map([["dim_cc", "field-uuid"]]),
        fieldValueIdsByValue: new Map([["dim_cc:cc_apollo", "value-uuid"]])
      }
    });
    expect(payload.items[0]?.fields).toEqual([
      { field_id: "field-uuid", field_value_id: "value-uuid" }
    ]);
  });

  it("drops a dimension whose Field or value was not provisioned", () => {
    const payload = mapCardTransactionToRilletCharge({
      charge: charge(),
      costing: costing(),
      ...base,
      dimensions: {
        fieldIdByDimensionId: new Map([["dim_cc", "field-uuid"]]),
        fieldValueIdsByValue: new Map()
      }
    });
    expect(payload.items[0]?.fields).toBeUndefined();
  });

  it("falls back to the card memo when a line has no description", () => {
    const payload = mapCardTransactionToRilletCharge({
      charge: charge(),
      costing: costing({ lines: [{ ...lines[0]!, description: null }] }),
      ...base
    });
    expect(payload.items[0]?.description).toBe(
      "SFO→ORD for the Apollo kickoff"
    );
  });

  it("converts a foreign charge to its transaction currency and pins the directed rate", () => {
    // A CAD charge: base USD lines × 1.25 CAD per USD.
    const payload = mapCardTransactionToRilletCharge({
      charge: charge(),
      costing: costing({
        lines: [{ ...lines[0]!, amount: 345.34 }],
        documentTotal: 431.68,
        currencyCode: "CAD",
        exchangeRate: 1.25
      }),
      ...base
    });
    expect(payload.exchange_rate).toEqual(
      toRilletExchangeRate({
        baseCurrencyCode: "USD",
        documentCurrencyCode: "CAD",
        foreignPerBaseRate: 1.25,
        date: "2026-09-08"
      })
    );
    expect(payload.items.map((item) => item.amount)).toEqual([
      { amount: "431.68", currency: "CAD" }
    ]);
  });

  it("includes the subsidiary when the provider has one", () => {
    const payload = mapCardTransactionToRilletCharge({
      charge: charge(),
      costing: costing(),
      ...base,
      subsidiaryId: "sub-uuid"
    });
    expect(payload.subsidiary_id).toBe("sub-uuid");
  });

  it("fails as the UNMAPPED_ACCOUNTS Warning when a line account is unmapped", () => {
    expect(() =>
      mapCardTransactionToRilletCharge({
        charge: charge(),
        costing: costing(),
        ...base,
        accountCodesById: new Map([["acct_ramp", "2100"]])
      })
    ).toThrow(JournalEntrySyncError);
    try {
      mapCardTransactionToRilletCharge({
        charge: charge(),
        costing: costing(),
        ...base,
        accountCodesById: new Map([["acct_ramp", "2100"]])
      });
    } catch (err) {
      expect(err).toBeInstanceOf(JournalEntrySyncError);
      expect((err as JournalEntrySyncError).failure).toMatchObject({
        errorCode: "UNMAPPED_ACCOUNTS",
        metadata: { unmappedAccountIds: ["acct_travel"] }
      });
    }
  });

  it("fails as the UNMAPPED_ACCOUNTS Warning when the card-liability account is unmapped", () => {
    expect(() =>
      mapCardTransactionToRilletCharge({
        charge: charge(),
        costing: costing(),
        ...base,
        accountCodesById: new Map([["acct_travel", "6100"]])
      })
    ).toThrow(JournalEntrySyncError);
  });

  it("fails as a Warning when there is no posted journal to replay", () => {
    expect(() =>
      mapCardTransactionToRilletCharge({
        charge: charge(),
        costing: costing({ lines: [] }),
        ...base
      })
    ).toThrow(JournalEntrySyncError);
  });
});
