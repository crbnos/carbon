import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import { Rillet } from "../../models";
import { type BillPostingJournalLine, mapBillToRilletBill } from "../bill";
import { toRilletExchangeRate } from "../shared";

// The bill's G/L costing comes from its posted Purchase Invoice journal
// (item-backed invoice lines carry no account of their own): journal lines
// minus the AP control line ARE the Rillet bill items.

const bill = (): Accounting.Bill =>
  ({
    id: "pi_1",
    companyId: "company-1",
    invoiceId: "AP000001",
    supplierId: "sup_1",
    supplierExternalId: null,
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
    updatedAt: "2026-08-04T00:00:00.000Z"
  }) as unknown as Accounting.Bill;

const journalLines: BillPostingJournalLine[] = [
  // Debit-signed costing: GR/IR clearing debit +300; loader excluded AP.
  {
    id: "jl-1",
    accountId: "acct_grir",
    amount: 300,
    description: "GR/IR Clearing"
  }
];

const codes = new Map([["acct_grir", "2125"]]);

describe("mapBillToRilletBill (journal-derived costing)", () => {
  it("builds items from the loader's costing-only rows", () => {
    const payload = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: journalLines
    });

    expect(payload.vendor_id).toBe("vendor-remote-1");
    expect(payload.expense_number).toBe("AP000001");
    expect(payload.items).toEqual([
      {
        account_code: "2125",
        amount: { amount: "300.00", currency: "USD" },
        description: "GR/IR Clearing"
      }
    ]);
  });

  it("warns when the invoice has no posted journal", () => {
    expect(() =>
      mapBillToRilletBill({
        documentTotal: 300,
        decimalPlaces: 2,
        baseCurrencyCode: "USD",
        postingDate: "2026-09-07",
        bill: bill(),
        vendorRemoteId: "vendor-remote-1",
        accountCodesById: codes,
        subsidiaryId: null,
        companyId: "company-1",
        postingJournalLines: []
      })
    ).toThrowError(JournalEntrySyncError);
    try {
      mapBillToRilletBill({
        documentTotal: 300,
        decimalPlaces: 2,
        baseCurrencyCode: "USD",
        postingDate: "2026-09-07",
        bill: bill(),
        vendorRemoteId: "vendor-remote-1",
        accountCodesById: codes,
        subsidiaryId: null,
        companyId: "company-1",
        postingJournalLines: []
      });
    } catch (error) {
      expect((error as JournalEntrySyncError).failure.message).toContain(
        "no posted Purchase Invoice journal"
      );
      expect((error as JournalEntrySyncError).failure.warning).toBe(true);
    }
  });

  it("warns on unmapped costing accounts (costing-only input)", () => {
    try {
      mapBillToRilletBill({
        documentTotal: 300,
        decimalPlaces: 2,
        baseCurrencyCode: "USD",
        postingDate: "2026-09-07",
        bill: bill(),
        vendorRemoteId: "vendor-remote-1",
        accountCodesById: new Map(),
        subsidiaryId: null,
        companyId: "company-1",
        postingJournalLines: journalLines
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const failure = (error as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.metadata?.unmappedAccountIds).toEqual(["acct_grir"]);
    }
  });

  it("keeps variance/tax lines as additional items", () => {
    const payload = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: new Map([
        ["acct_grir", "2125"],
        ["acct_ppv", "5210"]
      ]),
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 280,
          description: "GR/IR Clearing"
        },
        {
          id: "jl-2",
          accountId: "acct_ppv",
          amount: 20,
          description: "Purchase Price Variance"
        }
      ]
    });

    expect(payload.items.map((i) => [i.account_code, i.amount.amount])).toEqual(
      [
        ["2125", "280.00"],
        ["5210", "20.00"]
      ]
    );
  });
});

describe("mapBillToRilletBill — item labels + FX (representation model)", () => {
  it("prepends the item code/name label to PO-backed line descriptions", () => {
    const payload = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300,
          description: "GR/IR Clearing",
          sourceItem: { id: "item-1", code: "WIDGET-1", name: "Widget" }
        }
      ]
    });

    expect(payload.items[0]?.description).toBe(
      "WIDGET-1 Widget — GR/IR Clearing"
    );
    // account + amount unchanged vs the no-label case (parity, base currency).
    expect(payload.items[0]?.account_code).toBe("2125");
    expect(payload.items[0]?.amount).toEqual({
      amount: "300.00",
      currency: "USD"
    });
    expect(payload.exchange_rate).toBeUndefined();
  });

  it("uses the item label alone when the line has no journal description", () => {
    const payload = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300,
          description: null,
          sourceItem: { id: "item-1", code: "WIDGET-1", name: null }
        }
      ]
    });
    expect(payload.items[0]?.description).toBe("WIDGET-1");
  });

  it("replays an FX bill in transaction currency + pins exchange_rate", () => {
    const fxBill = {
      ...bill(),
      currencyCode: "EUR",
      exchangeRate: 0.8
    } as unknown as Accounting.Bill;

    const payload = mapBillToRilletBill({
      documentTotal: 224,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: fxBill,
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: new Map([
        ["acct_grir", "2125"],
        ["acct_ppv", "5210"]
      ]),
      subsidiaryId: null,
      companyId: "company-1",
      // Base-currency debit-signed amounts convert once by multiplication.
      postingJournalLines: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300,
          description: "GR/IR Clearing"
        },
        {
          id: "jl-2",
          accountId: "acct_ppv",
          amount: -20,
          description: "Purchase Price Variance"
        }
      ]
    });

    expect(payload.exchange_rate).toEqual({
      base: "USD",
      target: "EUR",
      rate: "0.8",
      date: "2026-09-07"
    });
    expect(payload.items.map((i) => [i.account_code, i.amount])).toEqual([
      ["2125", { amount: "240.00", currency: "EUR" }],
      ["5210", { amount: "-16.00", currency: "EUR" }]
    ]);
  });
});

describe("mapBillToRilletBill — dimensions (Fields)", () => {
  const LOCATION_DIM = "dim_loc";
  const LOCATION_FIELD_ID = "f1d10000-0000-0000-0000-000000000001";

  const dimensionedLines: BillPostingJournalLine[] = [
    {
      id: "jl-1",
      accountId: "acct_grir",
      amount: 300,
      description: "GR/IR Clearing",
      dimensions: [{ dimensionId: LOCATION_DIM, valueId: "loc_hq" }]
    }
  ];

  const fieldIdByDimensionId = new Map([[LOCATION_DIM, LOCATION_FIELD_ID]]);

  it("attaches uuid field refs to items from their posting journal line dimensions", () => {
    const payload = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: dimensionedLines,
      dimensions: {
        fieldIdByDimensionId,
        fieldValueIdsByValue: new Map([["dim_loc:loc_hq", "fv-hq"]])
      }
    });

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.fields).toEqual([
      { field_id: LOCATION_FIELD_ID, field_value_id: "fv-hq" }
    ]);
  });

  it("omits fields for unmapped values (drop path) and when no dimension args are passed", () => {
    const dropped = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: dimensionedLines,
      dimensions: { fieldIdByDimensionId, fieldValueIdsByValue: new Map() }
    });
    expect(dropped.items[0]?.fields).toBeUndefined();

    const withoutArgs = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: dimensionedLines
    });
    expect(withoutArgs.items[0]?.fields).toBeUndefined();
  });

  it("omits a dimension whose Field was not provisioned (no field mapping)", () => {
    const payload = mapBillToRilletBill({
      documentTotal: 300,
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07",
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: [
        {
          id: "jl-1",
          accountId: "acct_grir",
          amount: 300,
          description: "GR/IR Clearing",
          dimensions: [{ dimensionId: "dim_unprovisioned", valueId: "v1" }]
        }
      ],
      dimensions: {
        fieldIdByDimensionId, // only LOCATION_DIM is mapped
        fieldValueIdsByValue: new Map([["dim_unprovisioned:v1", "fv-x"]])
      }
    });
    expect(payload.items[0]?.fields).toBeUndefined();
  });
});

describe("Rillet bill currency contract", () => {
  it("serializes the directed exchange-rate object without money rounding", () => {
    const rate = toRilletExchangeRate({
      baseCurrencyCode: "USD",
      documentCurrencyCode: "EUR",
      foreignPerBaseRate: 0.8,
      date: "2026-09-07"
    });
    expect(Rillet.ExchangeRateSchema.parse(rate)).toEqual({
      base: "USD",
      target: "EUR",
      rate: "0.8",
      date: "2026-09-07"
    });
    expect(
      toRilletExchangeRate({
        baseCurrencyCode: "USD",
        documentCurrencyCode: "USD",
        foreignPerBaseRate: 1,
        date: "2026-09-07"
      })
    ).toBeUndefined();
    expect(() =>
      toRilletExchangeRate({
        baseCurrencyCode: "USD",
        documentCurrencyCode: "USD",
        foreignPerBaseRate: 2,
        date: "2026-09-07"
      })
    ).toThrow();
  });
  it.each([
    [0, "80"],
    [3, "80.003"]
  ])("serializes bill currency decimal scale %i", (decimalPlaces, expected) => {
    const total = Number(expected);
    const payload = mapBillToRilletBill({
      bill: { ...bill(), currencyCode: "EUR", exchangeRate: 0.8 },
      vendorRemoteId: "v",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: [
        {
          id: "j",
          accountId: "acct_grir",
          amount: total / 0.8,
          description: null
        }
      ],
      documentTotal: total,
      decimalPlaces,
      baseCurrencyCode: "USD",
      postingDate: "2026-09-07"
    });
    expect(payload.items[0]?.amount).toEqual({
      amount: expected,
      currency: "EUR"
    });
  });
});
