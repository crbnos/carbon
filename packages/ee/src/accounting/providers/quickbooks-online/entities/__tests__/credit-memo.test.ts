import { describe, expect, it, vi } from "vitest";
import { CREDIT_REASON_ITEM_ENTITY_TYPE } from "../../../../core/credit-reason-item";
import type { ExternalIntegrationMappingService } from "../../../../core/external-mapping";
import type { Qbo } from "../../models";
import {
  buildQboCreditMemoApplicationPayload,
  buildQboCreditMemoPayload,
  buildQboCreditReasonItemName,
  QBO_MEMO_INCREASER_SKIP_REASON,
  type QboMemoSettlementRow,
  type QboMemoSource,
  qboCreditMemoSkipReason,
  resolveQboCreditReasonItemRef
} from "../credit-memo";
import {
  buildQboVendorCreditApplicationPayload,
  buildQboVendorCreditPayload,
  qboVendorCreditSkipReason
} from "../vendor-credit";

const INTEGRATION = "quickbooks";
const REASON_ACCOUNT_REF: Qbo.Ref = { value: "84", name: "Sales Returns" };

function memo(overrides: Partial<QboMemoSource> = {}): QboMemoSource {
  return {
    id: "memo_1",
    memoId: "CM-000042",
    direction: "Credit",
    status: "Posted",
    customerId: "cust_1",
    supplierId: null,
    memoDate: "2026-09-20",
    postingDate: "2026-09-21",
    currencyCode: "USD",
    exchangeRate: 1,
    amount: 250,
    reasonAccount: "acc_returns",
    reference: null,
    notes: "Short shipment on SO-000019",
    updatedAt: "2026-09-21T10:00:00.000Z",
    settlements: [],
    ...overrides
  };
}

/**
 * One `invoiceSettlement` row applying the memo. The default is the
 * foreign-currency case this fixture exists for: 100 EUR of principal
 * (`sourceAmount`) carried as 125 USD of base relief (`appliedAmount`) at
 * Carbon's 0.8 EUR-per-USD rate.
 */
function settlement(
  overrides: Partial<QboMemoSettlementRow> = {}
): QboMemoSettlementRow {
  return {
    id: "isl_1",
    appliedAmount: 125,
    sourceAmount: 100,
    appliedDate: "2026-09-22",
    targetSalesInvoiceId: "sinv_1",
    targetPurchaseInvoiceId: null,
    targetMemoId: null,
    discountAmount: 0,
    writeOffAmount: 0,
    sourceExchangeRate: 0.8,
    targetExchangeRate: 0.8,
    ...overrides
  };
}

/**
 * Minimal in-memory mapping service — only the two methods the credit-reason
 * resolver touches, backed by a Map so a `link` is visible to the next
 * `getExternalId`. That visibility is what the item-reuse case actually proves.
 */
function makeMapping(seed: Record<string, string> = {}) {
  const rows = new Map<string, string>(Object.entries(seed));
  const key = (entityType: string, entityId: string, integration: string) =>
    `${entityType}::${entityId}::${integration}`;

  return {
    service: {
      getExternalId: vi.fn(
        async (entityType: string, entityId: string, integration: string) =>
          rows.get(key(entityType, entityId, integration)) ?? null
      ),
      link: vi.fn(
        async (
          entityType: string,
          entityId: string,
          integration: string,
          externalId: string
        ) => {
          rows.set(key(entityType, entityId, integration), externalId);
        }
      )
    } as unknown as ExternalIntegrationMappingService,
    rows,
    key
  };
}

describe("buildQboCreditMemoPayload", () => {
  it("emits ONE SalesItemLineDetail line carrying an ItemRef and a non-zero Amount", () => {
    const payload = buildQboCreditMemoPayload({
      memo: memo(),
      customerRef: { value: "17" },
      reasonItemRef: { value: "901" },
      baseCurrencyCode: "USD"
    });

    expect(payload.CustomerRef).toEqual({ value: "17" });
    expect(payload.DocNumber).toBe("CM-000042");
    // The posting date is the GL date Carbon booked.
    expect(payload.TxnDate).toBe("2026-09-21");
    expect(payload.Line).toEqual([
      {
        Amount: 250,
        Description: "Short shipment on SO-000019",
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "901" },
          Qty: 1,
          UnitPrice: 250
        }
      }
    ]);

    // The trap this whole design exists for: an item-less line has its Amount
    // SILENTLY ignored by QBO, so the ItemRef must always be present and the
    // Amount must never be zero.
    const line = payload.Line[0]!;
    expect(line.SalesItemLineDetail?.ItemRef).toBeDefined();
    expect(line.Amount).toBeGreaterThan(0);

    // Base currency: no FX fields at all.
    expect(payload.CurrencyRef).toBeUndefined();
    expect(payload.ExchangeRate).toBeUndefined();
  });

  it("inverts Carbon's exchange rate to QBO's home-per-foreign convention", () => {
    const payload = buildQboCreditMemoPayload({
      // Carbon: 0.8 EUR per 1 USD of base. QBO wants USD per 1 EUR = 1.25.
      memo: memo({ currencyCode: "EUR", exchangeRate: 0.8 }),
      customerRef: { value: "17" },
      reasonItemRef: { value: "901" },
      baseCurrencyCode: "USD"
    });

    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBeCloseTo(1.25, 10);
  });
});

describe("resolveQboCreditReasonItemRef", () => {
  it("creates exactly ONE Service item per reason account and reuses it", async () => {
    const mapping = makeMapping();
    const createServiceItem = vi.fn(async () => ({ Id: "901" }));

    const first = await resolveQboCreditReasonItemRef({
      mapping: mapping.service,
      integration: INTEGRATION,
      accountId: "acc_returns",
      accountNumber: "41100",
      accountName: "Sales Returns",
      incomeAccountRef: REASON_ACCOUNT_REF,
      createServiceItem
    });

    expect(first).toEqual({ value: "901" });
    expect(createServiceItem).toHaveBeenCalledTimes(1);
    expect(createServiceItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "41100 Sales Returns (Carbon)",
        incomeAccountRef: REASON_ACCOUNT_REF
      })
    );
    expect(
      mapping.rows.get(
        mapping.key(CREDIT_REASON_ITEM_ENTITY_TYPE, "acc_returns", INTEGRATION)
      )
    ).toBe("901");

    // A SECOND memo on the same reason account must create NO second item.
    const second = await resolveQboCreditReasonItemRef({
      mapping: mapping.service,
      integration: INTEGRATION,
      accountId: "acc_returns",
      accountNumber: "41100",
      accountName: "Sales Returns",
      incomeAccountRef: REASON_ACCOUNT_REF,
      createServiceItem
    });

    expect(second).toEqual({ value: "901" });
    expect(createServiceItem).toHaveBeenCalledTimes(1);
  });

  it("keeps the item name inside QBO's 100-character cap", () => {
    const name = buildQboCreditReasonItemName({
      accountNumber: "41100",
      accountName: "X".repeat(200),
      accountId: "acc_returns"
    });

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith(" (Carbon)")).toBe(true);
  });
});

describe("buildQboVendorCreditPayload", () => {
  it("codes the line to the reason ACCOUNT and sets APAccountRef explicitly", () => {
    const payload = buildQboVendorCreditPayload({
      memo: memo({
        id: "memo_2",
        memoId: "DM-000007",
        direction: "Debit",
        customerId: null,
        supplierId: "supp_1",
        notes: null,
        reference: "RMA-19"
      }),
      vendorRef: { value: "55" },
      reasonAccountRef: REASON_ACCOUNT_REF,
      apAccountRef: { value: "33", name: "Accounts Payable" },
      baseCurrencyCode: "USD"
    });

    expect(payload.VendorRef).toEqual({ value: "55" });
    expect(payload.APAccountRef).toEqual({
      value: "33",
      name: "Accounts Payable"
    });
    expect(payload.Line).toEqual([
      {
        Amount: 250,
        Description: "RMA-19",
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: { AccountRef: REASON_ACCOUNT_REF }
      }
    ]);
    // No credit-reason item is involved on the AP side.
    expect(JSON.stringify(payload)).not.toContain("ItemRef");
  });

  it("omits APAccountRef when the payables account is not mapped", () => {
    const payload = buildQboVendorCreditPayload({
      memo: memo({
        direction: "Debit",
        customerId: null,
        supplierId: "supp_1"
      }),
      vendorRef: { value: "55" },
      reasonAccountRef: REASON_ACCOUNT_REF,
      baseCurrencyCode: "USD"
    });

    expect(payload.APAccountRef).toBeUndefined();
  });
});

/**
 * The currency of an APPLICATION, which is a different question from the
 * currency of the credit document. `appliedAmount` is base-currency carrying
 * value; a QBO Payment/BillPayment line is in the transaction's currency.
 */
describe("applying a memo in the document currency", () => {
  it("sends the memo-currency principal, not the base-currency applied amount", () => {
    const payload = buildQboCreditMemoApplicationPayload({
      memo: memo({ currencyCode: "EUR", exchangeRate: 0.8 }),
      settlement: settlement(),
      customerRef: { value: "17" },
      invoiceRemoteId: "440",
      creditMemoRemoteId: "512",
      baseCurrencyCode: "USD"
    });

    // 100 EUR of credit, NOT the 125 USD of base relief the row also carries.
    expect(payload.Line.map((line) => line.Amount)).toEqual([100, 100]);
    expect(payload.TotalAmt).toBe(0);
    expect(payload.TxnDate).toBe("2026-09-22");
    expect(payload.Line[0]?.LinkedTxn).toEqual([
      { TxnId: "440", TxnType: "Invoice" }
    ]);
    expect(payload.Line[1]?.LinkedTxn).toEqual([
      { TxnId: "512", TxnType: "CreditMemo" }
    ]);
    // The transaction currency is stated, not inherited from the customer, and
    // the rate is inverted to QBO's home-per-foreign convention.
    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBeCloseTo(1.25, 10);
  });

  it("does the same on the AP side, on top of the required zero-cash bank fields", () => {
    const payload = buildQboVendorCreditApplicationPayload({
      memo: memo({
        direction: "Debit",
        customerId: null,
        supplierId: "supp_1",
        currencyCode: "EUR",
        exchangeRate: 0.8
      }),
      settlement: settlement({
        targetSalesInvoiceId: null,
        targetPurchaseInvoiceId: "pinv_1"
      }),
      vendorRef: { value: "55" },
      bankAccountRef: { value: "35", name: "Checking" },
      billRemoteId: "701",
      vendorCreditRemoteId: "702",
      baseCurrencyCode: "USD"
    });

    expect(payload.Line.map((line) => line.Amount)).toEqual([100, 100]);
    expect(payload.PayType).toBe("Check");
    expect(payload.CheckPayment).toEqual({
      BankAccountRef: { value: "35", name: "Checking" }
    });
    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBeCloseTo(1.25, 10);
  });

  it("adds no FX fields when the memo is in base currency — the two amounts agree there", () => {
    const payload = buildQboCreditMemoApplicationPayload({
      memo: memo(),
      settlement: settlement({
        appliedAmount: 90,
        sourceAmount: 90,
        sourceExchangeRate: 1,
        targetExchangeRate: 1
      }),
      customerRef: { value: "17" },
      invoiceRemoteId: "440",
      creditMemoRemoteId: "512",
      baseCurrencyCode: "USD"
    });

    expect(payload.Line.map((line) => line.Amount)).toEqual([90, 90]);
    expect(payload.CurrencyRef).toBeUndefined();
    expect(payload.ExchangeRate).toBeUndefined();
  });

  it("falls back to appliedAmount on a legacy base-currency row, and refuses a foreign one", () => {
    const legacy = settlement({ appliedAmount: 90, sourceAmount: null });

    expect(
      buildQboCreditMemoApplicationPayload({
        memo: memo(),
        settlement: legacy,
        customerRef: { value: "17" },
        invoiceRemoteId: "440",
        creditMemoRemoteId: "512",
        baseCurrencyCode: "USD"
      }).Line.map((line) => line.Amount)
    ).toEqual([90, 90]);

    // A foreign row with no stored principal is refused rather than converted
    // back from the rounded base value.
    expect(() =>
      buildQboCreditMemoApplicationPayload({
        memo: memo({ currencyCode: "EUR", exchangeRate: 0.8 }),
        settlement: legacy,
        customerRef: { value: "17" },
        invoiceRemoteId: "440",
        creditMemoRemoteId: "512",
        baseCurrencyCode: "USD"
      })
    ).toThrow(/carries no document principal/);
  });
});

describe("the v1 increaser skip (canonical rule, shared by all providers)", () => {
  it("skips a customer + Debit memo with the v1-limitation reason", () => {
    const reason = qboCreditMemoSkipReason(memo({ direction: "Debit" }));

    expect(reason).toContain(QBO_MEMO_INCREASER_SKIP_REASON);
    expect(reason).toContain("CM-000042");
  });

  it("skips a supplier + Credit memo with the v1-limitation reason", () => {
    const reason = qboVendorCreditSkipReason(
      memo({
        memoId: "CM-000099",
        direction: "Credit",
        customerId: null,
        supplierId: "supp_1"
      })
    );

    expect(reason).toContain(QBO_MEMO_INCREASER_SKIP_REASON);
    expect(reason).toContain("CM-000099");
  });

  it("pushes the two reducer combos", () => {
    expect(qboCreditMemoSkipReason(memo())).toBeNull();
    expect(
      qboVendorCreditSkipReason(
        memo({ direction: "Debit", customerId: null, supplierId: "supp_1" })
      )
    ).toBeNull();
  });

  it("skips a memo that is not posted, and one of the wrong party", () => {
    expect(qboCreditMemoSkipReason(memo({ status: "Draft" }))).toContain(
      "only Posted memos push"
    );
    expect(
      qboCreditMemoSkipReason(
        memo({ customerId: null, supplierId: "supp_1", direction: "Debit" })
      )
    ).toContain("not a customer memo");
    expect(qboVendorCreditSkipReason(memo())).toContain("not a supplier memo");
  });
});
