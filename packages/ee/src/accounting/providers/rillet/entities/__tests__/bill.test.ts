import { describe, expect, it } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import { type BillPostingJournalLine, mapBillToRilletBill } from "../bill";

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
  // Debit-signed: GR/IR clearing debit +300, AP credit -300
  {
    id: "jl-1",
    accountId: "acct_grir",
    amount: 300,
    description: "GR/IR Clearing"
  },
  {
    id: "jl-2",
    accountId: "acct_ap",
    amount: -300,
    description: "Accounts Payable"
  }
];

const codes = new Map([["acct_grir", "2125"]]);

describe("mapBillToRilletBill (journal-derived costing)", () => {
  it("builds items from the posting journal minus the AP control line", () => {
    const payload = mapBillToRilletBill({
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: journalLines,
      payablesAccountId: "acct_ap"
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
        bill: bill(),
        vendorRemoteId: "vendor-remote-1",
        accountCodesById: codes,
        subsidiaryId: null,
        companyId: "company-1",
        postingJournalLines: [],
        payablesAccountId: "acct_ap"
      })
    ).toThrowError(JournalEntrySyncError);
    try {
      mapBillToRilletBill({
        bill: bill(),
        vendorRemoteId: "vendor-remote-1",
        accountCodesById: codes,
        subsidiaryId: null,
        companyId: "company-1",
        postingJournalLines: [],
        payablesAccountId: "acct_ap"
      });
    } catch (error) {
      expect((error as JournalEntrySyncError).failure.message).toContain(
        "no posted Purchase Invoice journal"
      );
      expect((error as JournalEntrySyncError).failure.warning).toBe(true);
    }
  });

  it("warns on unmapped costing accounts (AP line still excluded)", () => {
    try {
      mapBillToRilletBill({
        bill: bill(),
        vendorRemoteId: "vendor-remote-1",
        accountCodesById: new Map(),
        subsidiaryId: null,
        companyId: "company-1",
        postingJournalLines: journalLines,
        payablesAccountId: "acct_ap"
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
        },
        {
          id: "jl-3",
          accountId: "acct_ap",
          amount: -300,
          description: "Accounts Payable"
        }
      ],
      payablesAccountId: "acct_ap"
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
      ],
      payablesAccountId: "acct_ap"
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
      ],
      payablesAccountId: "acct_ap"
    });
    expect(payload.items[0]?.description).toBe("WIDGET-1");
  });

  it("replays an FX bill in transaction currency + pins exchange_rate", () => {
    const fxBill = {
      ...bill(),
      currencyCode: "EUR",
      exchangeRate: 2
    } as unknown as Accounting.Bill;

    const payload = mapBillToRilletBill({
      bill: fxBill,
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: new Map([
        ["acct_grir", "2125"],
        ["acct_ppv", "5210"]
      ]),
      subsidiaryId: null,
      companyId: "company-1",
      // base-currency debit-signed amounts (rate 2 → half in EUR)
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
      ],
      payablesAccountId: "acct_ap"
    });

    expect(payload.exchange_rate).toBe(2);
    expect(payload.items.map((i) => [i.account_code, i.amount])).toEqual([
      ["2125", { amount: "150.00", currency: "EUR" }],
      ["5210", { amount: "-10.00", currency: "EUR" }]
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
    },
    {
      id: "jl-2",
      accountId: "acct_ap",
      amount: -300,
      description: "Accounts Payable",
      // AP control line dimensions never push (the line itself is excluded)
      dimensions: [{ dimensionId: LOCATION_DIM, valueId: "loc_other" }]
    }
  ];

  const fieldIdByDimensionId = new Map([[LOCATION_DIM, LOCATION_FIELD_ID]]);

  it("attaches uuid field refs to items from their posting journal line dimensions", () => {
    const payload = mapBillToRilletBill({
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: dimensionedLines,
      payablesAccountId: "acct_ap",
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
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: dimensionedLines,
      payablesAccountId: "acct_ap",
      dimensions: { fieldIdByDimensionId, fieldValueIdsByValue: new Map() }
    });
    expect(dropped.items[0]?.fields).toBeUndefined();

    const withoutArgs = mapBillToRilletBill({
      bill: bill(),
      vendorRemoteId: "vendor-remote-1",
      accountCodesById: codes,
      subsidiaryId: null,
      companyId: "company-1",
      postingJournalLines: dimensionedLines,
      payablesAccountId: "acct_ap"
    });
    expect(withoutArgs.items[0]?.fields).toBeUndefined();
  });

  it("omits a dimension whose Field was not provisioned (no field mapping)", () => {
    const payload = mapBillToRilletBill({
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
      payablesAccountId: "acct_ap",
      dimensions: {
        fieldIdByDimensionId, // only LOCATION_DIM is mapped
        fieldValueIdsByValue: new Map([["dim_unprovisioned:v1", "fv-x"]])
      }
    });
    expect(payload.items[0]?.fields).toBeUndefined();
  });
});
