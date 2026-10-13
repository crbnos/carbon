// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_REASON_ITEM_ENTITY_TYPE } from "../../../../core/credit-reason-item";
import type { ExternalIntegrationMappingService } from "../../../../core/external-mapping";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { Qbo } from "../../models";
import {
  buildQboCreditMemoApplicationPayload,
  buildQboCreditMemoPayload,
  buildQboCreditReasonItemName,
  QBO_MEMO_INCREASER_SKIP_REASON,
  QboCreditMemoSyncer,
  type QboMemoSettlementRow,
  type QboMemoSource,
  qboCreditMemoSkipReason,
  qboMemoApplicationAmount,
  resolveQboCreditReasonItemRef
} from "../credit-memo";
import {
  buildQboVendorCreditApplicationPayload,
  buildQboVendorCreditPayload,
  QboVendorCreditSyncer,
  qboVendorCreditSkipReason
} from "../vendor-credit";

/**
 * `recordQboMemoApplication` writes its mapping row inside
 * `withTriggersDisabled`, a real Kysely transaction that opens with a `SET LOCAL`
 * statement. Stub it so the row lands in `mappingRows` instead — that map is the
 * durable store the resumability test reads back.
 */
const { mappingRows } = vi.hoisted(() => ({
  mappingRows: new Map<string, string>()
}));
vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    cb: (tx: unknown) => Promise<unknown>
  ) => {
    const builder: Record<string, any> = {};
    builder.values = (value: any) => {
      for (const row of Array.isArray(value) ? value : [value]) {
        mappingRows.set(`${row.entityType}::${row.entityId}`, row.externalId);
      }
      return builder;
    };
    builder.onConflict = () => builder;
    builder.execute = async () => [];
    return cb({ insertInto: () => builder });
  }
}));

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

/**
 * The invariant behind `qboMemoCurrencyFields`: the APPLICATION carries exactly
 * the FX fields its own DOCUMENT carries. If the two ever diverge, QBO values
 * the application at a different rate than the credit it applies, the credit's
 * home-currency balance does not close, and the difference lands in FX
 * gain/loss.
 */
describe("the application's FX fields match its document's, both sides", () => {
  const foreign = { currencyCode: "EUR", exchangeRate: 0.8 };

  it.each([
    ["foreign", foreign, { CurrencyRef: { value: "EUR" }, ExchangeRate: 1.25 }],
    ["base", {}, undefined]
  ] as const)("agrees on an AR %s memo", (_label, override, expected) => {
    const source = memo({ ...override, settlements: [settlement()] });
    const document = buildQboCreditMemoPayload({
      memo: source,
      customerRef: { value: "17" },
      reasonItemRef: { value: "901" },
      baseCurrencyCode: "USD"
    });
    const application = buildQboCreditMemoApplicationPayload({
      memo: source,
      settlement: source.settlements[0]!,
      customerRef: { value: "17" },
      invoiceRemoteId: "qbo-invoice-si_1",
      creditMemoRemoteId: "qbo-cm-1",
      baseCurrencyCode: "USD"
    });

    for (const payload of [document, application]) {
      if (expected) {
        expect(payload.CurrencyRef).toEqual(expected.CurrencyRef);
        expect(payload.ExchangeRate).toBeCloseTo(expected.ExchangeRate, 10);
      } else {
        expect(payload).not.toHaveProperty("CurrencyRef");
        expect(payload).not.toHaveProperty("ExchangeRate");
      }
    }
  });

  it.each([
    ["foreign", foreign, { CurrencyRef: { value: "EUR" }, ExchangeRate: 1.25 }],
    ["base", {}, undefined]
  ] as const)("agrees on an AP %s memo", (_label, override, expected) => {
    const source = supplierMemo({
      ...override,
      settlements: [supplierSettlement()]
    });
    const document = buildQboVendorCreditPayload({
      memo: source,
      vendorRef: { value: "55" },
      reasonAccountRef: REASON_ACCOUNT_REF,
      baseCurrencyCode: "USD"
    });
    const application = buildQboVendorCreditApplicationPayload({
      memo: source,
      settlement: source.settlements[0]!,
      vendorRef: { value: "55" },
      bankRef: { value: "60" },
      billRemoteId: "qbo-bill-pi_1",
      vendorCreditRemoteId: "qbo-vc-1",
      baseCurrencyCode: "USD"
    });

    for (const payload of [document, application]) {
      if (expected) {
        expect(payload.CurrencyRef).toEqual(expected.CurrencyRef);
        expect(payload.ExchangeRate).toBeCloseTo(expected.ExchangeRate, 10);
      } else {
        expect(payload).not.toHaveProperty("CurrencyRef");
        expect(payload).not.toHaveProperty("ExchangeRate");
      }
    }
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

/**
 * A settlement, with the pair `.claude/rules/numeric-precision.md` cares about:
 * `sourceAmount` is the exact source-document principal (the MEMO's currency)
 * and `appliedAmount` is BASE currency. The two differ on every foreign memo.
 */
function settlement(
  overrides: Partial<QboMemoSettlementRow> = {}
): QboMemoSettlementRow {
  return {
    id: "st_1",
    sourceAmount: 100,
    appliedAmount: 100,
    appliedDate: "2026-09-22",
    targetSalesInvoiceId: "si_1",
    targetPurchaseInvoiceId: null,
    targetMemoId: null,
    discountAmount: 0,
    writeOffAmount: 0,
    sourceExchangeRate: 1,
    targetExchangeRate: 1,
    ...overrides
  };
}

/**
 * Drives `upsertRemote` (and so `applySettlements`) with no QBO and no database.
 *
 * `mappingRows` is the DURABLE store: `recordQboMemoApplication` writes into it
 * through the mocked `withTriggersDisabled` above, and the same rows back
 * `mappingService.getExternalId` — so a second push really does see what the
 * first one recorded, which is the whole claim of the resumability test.
 */
function makeCreditMemoSyncer(args: {
  memo: QboMemoSource;
  applyCreditMemo?: ReturnType<typeof vi.fn>;
  baseCurrencyCode?: string;
}) {
  const applyCreditMemo =
    args.applyCreditMemo ?? vi.fn(async () => "qbo-payment-1");
  const createCreditMemo = vi.fn(async () => ({ Id: "qbo-cm-1" }));

  const syncer = new QboCreditMemoSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: { id: INTEGRATION, createCreditMemo, applyCreditMemo } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "creditMemo"
  });

  const patched = syncer as unknown as Record<string, any>;
  patched.mappingService = {
    getByEntity: vi.fn(async () => null),
    getExternalId: vi.fn(async (entityType: string, entityId: string) =>
      entityType === "invoice"
        ? `qbo-invoice-${entityId}`
        : (mappingRows.get(`${entityType}::${entityId}`) ?? null)
    )
  };
  // The one company read `upsertRemote` needs — stubbed rather than faked,
  // there is no database in this process.
  patched.baseCurrencyCodePromise = Promise.resolve(
    args.baseCurrencyCode ?? "USD"
  );
  vi.spyOn(syncer, "fetchLocal").mockResolvedValue(args.memo);

  const push = () =>
    patched.upsertRemote(
      { CustomerRef: { value: "17" } } as never,
      args.memo.id
    ) as Promise<string>;

  return { push, applyCreditMemo, createCreditMemo };
}

/** The AP mirror: drives `QboVendorCreditSyncer.upsertRemote`. */
function makeVendorCreditSyncer(args: {
  memo: QboMemoSource;
  applyVendorCredit?: ReturnType<typeof vi.fn>;
  baseCurrencyCode?: string;
}) {
  const applyVendorCredit =
    args.applyVendorCredit ?? vi.fn(async () => "qbo-billpayment-1");
  const createVendorCredit = vi.fn(async () => ({ Id: "qbo-vc-1" }));

  const syncer = new QboVendorCreditSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: {
      id: INTEGRATION,
      createVendorCredit,
      applyVendorCredit
    } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "supplierCredit"
  });

  const patched = syncer as unknown as Record<string, any>;
  patched.mappingService = {
    getByEntity: vi.fn(async () => null),
    getExternalId: vi.fn(async (entityType: string, entityId: string) =>
      entityType === "bill"
        ? `qbo-bill-${entityId}`
        : (mappingRows.get(`${entityType}::${entityId}`) ?? null)
    )
  };
  patched.accountDefaultsPromise = Promise.resolve({
    payablesAccount: "acc_ap",
    bankCashAccount: "acc_bank"
  });
  patched.accountRefsByIdPromise = Promise.resolve(
    new Map<string, Qbo.Ref>([["acc_bank", { value: "60" }]])
  );
  patched.baseCurrencyCodePromise = Promise.resolve(
    args.baseCurrencyCode ?? "USD"
  );
  vi.spyOn(syncer, "fetchLocal").mockResolvedValue(args.memo);

  const push = () =>
    patched.upsertRemote(
      { VendorRef: { value: "55" } } as never,
      args.memo.id
    ) as Promise<string>;

  return { push, applyVendorCredit, createVendorCredit };
}

/** A supplier-side memo whose settlement targets a purchase invoice. */
function supplierMemo(overrides: Partial<QboMemoSource> = {}): QboMemoSource {
  return memo({
    id: "memo_2",
    memoId: "DM-000007",
    direction: "Debit",
    customerId: null,
    supplierId: "supp_1",
    ...overrides
  });
}

function supplierSettlement(
  overrides: Partial<QboMemoSettlementRow> = {}
): QboMemoSettlementRow {
  return settlement({
    targetSalesInvoiceId: null,
    targetPurchaseInvoiceId: "pi_1",
    ...overrides
  });
}

describe("qboMemoApplicationAmount (document currency, never base)", () => {
  it("returns the source-document principal", () => {
    expect(qboMemoApplicationAmount(memo(), settlement())).toBe(100);
  });

  it("refuses a settlement with no source principal rather than sending the base amount", () => {
    try {
      qboMemoApplicationAmount(
        memo(),
        settlement({ sourceAmount: null, appliedAmount: 108.7 })
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(JournalEntrySyncError);
      const failure = (error as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNSYNCED_DOCUMENT");
      expect(failure.warning).toBe(true);
    }
  });

  it("refuses a zero or negative principal", () => {
    expect(() =>
      qboMemoApplicationAmount(memo(), settlement({ sourceAmount: 0 }))
    ).toThrowError(JournalEntrySyncError);
  });
});

describe("the cross-currency application guard (parity with Xero)", () => {
  const crossCurrency = settlement({
    sourceExchangeRate: 0.92,
    targetExchangeRate: 0.88
  });

  it("skips a customer credit memo whose application crosses currencies", () => {
    const reason = qboCreditMemoSkipReason(
      memo({ settlements: [crossCurrency] })
    );
    expect(reason).toContain("cross-currency");
    expect(reason).toContain("st_1");
  });

  it("skips a supplier credit whose application crosses currencies", () => {
    const reason = qboVendorCreditSkipReason(
      memo({
        direction: "Debit",
        customerId: null,
        supplierId: "supp_1",
        settlements: [
          settlement({
            targetSalesInvoiceId: null,
            targetPurchaseInvoiceId: "pi_1",
            sourceExchangeRate: 0.92,
            targetExchangeRate: 0.88
          })
        ]
      })
    );
    expect(reason).toContain("cross-currency");
  });

  it("allows a same-rate foreign application", () => {
    expect(
      qboCreditMemoSkipReason(
        memo({
          currencyCode: "EUR",
          exchangeRate: 0.92,
          settlements: [
            settlement({ sourceExchangeRate: 0.92, targetExchangeRate: 0.92 })
          ]
        })
      )
    ).toBeNull();
  });
});

describe("QboCreditMemoSyncer.applySettlements", () => {
  beforeEach(() => {
    mappingRows.clear();
  });

  it("sends the DOCUMENT-currency principal for a foreign memo, not the base amount", async () => {
    // EUR 100.00 at 0.92 EUR per USD of base: appliedAmount is 108.70 base.
    const { push, applyCreditMemo } = makeCreditMemoSyncer({
      memo: memo({
        currencyCode: "EUR",
        exchangeRate: 0.92,
        amount: 100,
        settlements: [
          settlement({
            sourceAmount: 100,
            appliedAmount: 108.7,
            sourceExchangeRate: 0.92,
            targetExchangeRate: 0.92
          })
        ]
      })
    });

    await push();

    const payload = applyCreditMemo.mock.calls[0]?.[0] as {
      Line: Array<{ Amount: number }>;
    };
    expect(payload.Line.map((line) => line.Amount)).toEqual([100, 100]);
    expect(JSON.stringify(payload)).not.toContain("108.7");
  });

  it("refuses to apply a settlement with no source principal", async () => {
    const { push, applyCreditMemo } = makeCreditMemoSyncer({
      memo: memo({
        settlements: [settlement({ sourceAmount: null, appliedAmount: 100 })]
      })
    });

    await expect(push()).rejects.toThrowError(JournalEntrySyncError);
    expect(applyCreditMemo).not.toHaveBeenCalled();
  });

  /**
   * The cross-currency guard (`qboMemoApplicationSkipReason`) parks a settlement
   * whose SOURCE and TARGET rates disagree. It says nothing about the ordinary
   * foreign application — a EUR memo against a EUR invoice at one rate — which
   * passes it. Without `CurrencyRef`/`ExchangeRate` QuickBooks values the
   * home-currency side of that application at ITS rate for `TxnDate` instead of
   * Carbon's snapshot, so the credit memo's own home-currency balance does not
   * close and QBO books the difference as FX gain/loss.
   */
  it("sends CurrencyRef and the inverted ExchangeRate on a FOREIGN application", async () => {
    const { push, applyCreditMemo } = makeCreditMemoSyncer({
      memo: memo({
        currencyCode: "EUR",
        // Carbon: 0.8 EUR per 1 USD of base. QBO wants USD per 1 EUR = 1.25.
        exchangeRate: 0.8,
        amount: 100,
        settlements: [
          settlement({ sourceExchangeRate: 0.8, targetExchangeRate: 0.8 })
        ]
      })
    });

    await push();

    const payload = applyCreditMemo.mock.calls[0]?.[0] as {
      CurrencyRef?: Qbo.Ref;
      ExchangeRate?: number;
    };
    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBeCloseTo(1.25, 10);
  });

  it("sends no currency metadata at all on a base-currency application", async () => {
    const { push, applyCreditMemo } = makeCreditMemoSyncer({
      memo: memo({ settlements: [settlement()] })
    });

    await push();

    const payload = applyCreditMemo.mock.calls[0]?.[0] as object;
    expect(payload).not.toHaveProperty("CurrencyRef");
    expect(payload).not.toHaveProperty("ExchangeRate");
  });

  it("keeps the FIRST application durable when the second fails, and never re-applies it", async () => {
    const memoWithTwo = memo({
      settlements: [
        settlement({ id: "st_1", targetSalesInvoiceId: "si_1" }),
        settlement({ id: "st_2", targetSalesInvoiceId: "si_2" })
      ]
    });

    const failing = vi.fn(async (payload: any) =>
      (payload.Line[0].LinkedTxn[0].TxnId as string).includes("si_2")
        ? Promise.reject(new Error("QuickBooks Online returned 500"))
        : "qbo-payment-1"
    );
    const first = makeCreditMemoSyncer({
      memo: memoWithTwo,
      applyCreditMemo: failing
    });

    await expect(first.push()).rejects.toThrow("500");
    // The whole point: linkEntities never ran, so the memo's own mapping
    // metadata was never written — the per-application row is what survives.
    expect(mappingRows.get("qboMemoApplication::memo_1:st_1")).toBe(
      "qbo-payment-1"
    );

    const second = makeCreditMemoSyncer({ memo: memoWithTwo });
    await second.push();

    // ONE call, for st_2 only. Applying st_1 twice is real accounting
    // corruption, not a cosmetic duplicate.
    expect(second.applyCreditMemo).toHaveBeenCalledTimes(1);
    const retried = second.applyCreditMemo.mock.calls[0]?.[0] as {
      Line: Array<{ LinkedTxn: Array<{ TxnId: string }> }>;
    };
    expect(retried.Line[0]?.LinkedTxn[0]?.TxnId).toBe("qbo-invoice-si_2");
    expect(mappingRows.get("qboMemoApplication::memo_1:st_2")).toBe(
      "qbo-payment-1"
    );
  });
});

describe("QboVendorCreditSyncer.applySettlements", () => {
  beforeEach(() => {
    mappingRows.clear();
  });

  it("sends CurrencyRef and the inverted ExchangeRate on a FOREIGN BillPayment", async () => {
    const { push, applyVendorCredit } = makeVendorCreditSyncer({
      memo: supplierMemo({
        currencyCode: "EUR",
        exchangeRate: 0.8,
        amount: 100,
        settlements: [
          supplierSettlement({
            sourceExchangeRate: 0.8,
            targetExchangeRate: 0.8
          })
        ]
      })
    });

    await push();

    const payload = applyVendorCredit.mock.calls[0]?.[0] as {
      CurrencyRef?: Qbo.Ref;
      ExchangeRate?: number;
      CheckPayment?: { BankAccountRef: Qbo.Ref };
    };
    expect(payload.CurrencyRef).toEqual({ value: "EUR" });
    expect(payload.ExchangeRate).toBeCloseTo(1.25, 10);
    // The bank account QBO demands even at zero cash is unchanged.
    expect(payload.CheckPayment?.BankAccountRef).toEqual({ value: "60" });
  });

  it("sends no currency metadata at all on a base-currency BillPayment", async () => {
    const { push, applyVendorCredit } = makeVendorCreditSyncer({
      memo: supplierMemo({ settlements: [supplierSettlement()] })
    });

    await push();

    const payload = applyVendorCredit.mock.calls[0]?.[0] as object;
    expect(payload).not.toHaveProperty("CurrencyRef");
    expect(payload).not.toHaveProperty("ExchangeRate");
  });
});
