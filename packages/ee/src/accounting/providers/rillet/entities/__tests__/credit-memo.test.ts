// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountMappingRows,
  fakeDatabase
} from "../../../../core/fake-database-test-fixture";
import { JournalEntrySyncError } from "../../../../core/posting";
import type {
  Rillet,
  RilletCreditMemoCreate,
  RilletProductWrite,
  RilletVendorCreditCreate
} from "../../models";
import {
  buildCreditReasonProduct,
  buildRilletCreditMemoApplications,
  type CreditMemoSource,
  mapMemoToRilletCreditMemo,
  RilletCreditMemoSyncer
} from "../credit-memo";
import type { RilletMemoSource } from "../shared";
import {
  buildRilletVendorCreditApplications,
  mapMemoToRilletVendorCredit,
  RilletVendorCreditSyncer
} from "../vendor-credit";

const customerMemo = (
  overrides: Partial<RilletMemoSource> = {}
): CreditMemoSource => ({
  id: "memo_1",
  companyId: "company-1",
  memoId: "CM-2026-0001",
  direction: "Credit",
  status: "Posted",
  customerId: "cust_1",
  supplierId: null,
  partyExternalId: "rillet-customer-uuid",
  memoDate: "2026-09-20",
  postingDate: "2026-09-21",
  currencyCode: "USD",
  exchangeRate: 1,
  amount: 250,
  reasonAccount: "acct_returns",
  reference: "RMA-88",
  notes: "Short shipment on SO-1042",
  applications: [],
  updatedAt: "2026-09-21T10:00:00.000Z",
  ...overrides
});

const supplierMemo = (
  overrides: Partial<RilletMemoSource> = {}
): RilletMemoSource =>
  customerMemo({
    id: "memo_2",
    memoId: "DM-2026-0001",
    direction: "Debit",
    customerId: null,
    supplierId: "sup_1",
    partyExternalId: "rillet-vendor-uuid",
    ...overrides
  });

describe("mapMemoToRilletCreditMemo", () => {
  it("builds an items[] line with product_id, quantity 1 and the whole memo amount", () => {
    const payload = mapMemoToRilletCreditMemo({
      memo: customerMemo(),
      reasonProductId: "rillet-product-uuid",
      reasonAccountCode: "4200",
      reasonAccountName: "Sales Returns & Allowances",
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      customerRemoteId: "rillet-customer-uuid",
      subsidiaryId: null,
      companyId: "company-1"
    });

    expect(payload).toMatchObject({
      customer_id: "rillet-customer-uuid",
      credit_memo_date: "2026-09-21",
      credit_memo_number: "CM-2026-0001",
      items: [
        {
          description: "Short shipment on SO-1042",
          price: {
            product_id: "rillet-product-uuid",
            quantity: 1,
            amount_per_unit: { amount: "250.00", currency: "USD" }
          },
          // The per-line GL override names the same reason account the
          // product is bound to — belt and braces.
          revenue: { account_code: "4200" }
        }
      ]
    });
    expect(payload.external_references).toEqual([
      { type: "carbon", id: "memo_1" },
      { type: "carbon-company", id: "company-1" }
    ]);
  });
});

describe("mapMemoToRilletVendorCredit", () => {
  it("builds an account-coded line_items[] entry — no product on the AP side", () => {
    const payload = mapMemoToRilletVendorCredit({
      memo: supplierMemo(),
      reasonAccountCode: "4200",
      reasonAccountName: "Sales Returns & Allowances",
      decimalPlaces: 2,
      baseCurrencyCode: "USD",
      vendorRemoteId: "rillet-vendor-uuid",
      subsidiaryId: "rillet-subsidiary-uuid",
      companyId: "company-1"
    });

    // Field names VERIFIED against Rillet's OpenAPI CreateVendorCreditRequest:
    // `date` (not credit_date), `gl_impact_date` (not impact_date), and
    // subsidiary_id REQUIRED — unlike a bill, where it is optional.
    expect(payload).toMatchObject({
      vendor_id: "rillet-vendor-uuid",
      subsidiary_id: "rillet-subsidiary-uuid",
      date: "2026-09-20",
      gl_impact_date: "2026-09-21",
      credit_number: "DM-2026-0001",
      line_items: [
        {
          account_code: "4200",
          amount: { amount: "250.00", currency: "USD" },
          description: "Short shipment on SO-1042"
        }
      ]
    });

    // The vendor-credit create body accepts ONLY credit_number, date,
    // gl_impact_date, memo, line_items, vendor_id and subsidiary_id. Sending
    // external_references or exchange_rate (which bills and invoices DO take)
    // is not valid here — provenance rides credit_number and the mapping row.
    expect(payload).not.toHaveProperty("external_references");
    expect(payload).not.toHaveProperty("exchange_rate");
    expect(payload).not.toHaveProperty("credit_date");
    expect(payload).not.toHaveProperty("impact_date");
  });

  it("refuses to push without a subsidiary, which Rillet requires here", () => {
    expect(() =>
      mapMemoToRilletVendorCredit({
        memo: supplierMemo(),
        reasonAccountCode: "4200",
        reasonAccountName: "Sales Returns & Allowances",
        decimalPlaces: 2,
        baseCurrencyCode: "USD",
        vendorRemoteId: "rillet-vendor-uuid",
        subsidiaryId: null,
        companyId: "company-1"
      })
    ).toThrow(/subsidiary/i);
  });
});

describe("buildCreditReasonProduct", () => {
  it("binds the GL account to the product and marks it Carbon-managed", () => {
    expect(
      buildCreditReasonProduct({
        accountId: "acct_returns",
        accountName: "Sales Returns & Allowances",
        accountNumber: "4200",
        accountCode: "4200",
        currency: "USD",
        decimalPlaces: 2,
        companyId: "company-1"
      })
    ).toMatchObject({
      name: "4200 Sales Returns & Allowances (Carbon)",
      account_code: "4200",
      include_in_arr_mrr: false,
      price: { type: "ONE_TIME", amount: { amount: "0.00", currency: "USD" } }
    });
  });
});

describe("application sets", () => {
  it("parks the memo when an applied invoice is not synced yet", () => {
    expect(() =>
      buildRilletCreditMemoApplications({
        memo: customerMemo({
          applications: [
            {
              id: "st_1",
              targetSalesInvoiceId: "si_1",
              targetPurchaseInvoiceId: null,
              amount: 100,
              appliedDate: "2026-09-22"
            }
          ]
        }),
        invoiceRemoteIdsByLocalId: new Map(),
        decimalPlaces: 2
      })
    ).toThrow(JournalEntrySyncError);
  });

  it("omits application_date on the AP side", () => {
    expect(
      buildRilletVendorCreditApplications({
        memo: supplierMemo({
          applications: [
            {
              id: "st_3",
              targetSalesInvoiceId: null,
              targetPurchaseInvoiceId: "pi_1",
              amount: 75,
              appliedDate: "2026-09-22"
            }
          ]
        }),
        billRemoteIdsByLocalId: new Map([["pi_1", "rillet-bill-1"]]),
        decimalPlaces: 2
      })
    ).toEqual([
      { bill_id: "rillet-bill-1", amount: { amount: "75.00", currency: "USD" } }
    ]);
  });
});

/** The company, its currency and the reason account the memo syncers read. */
function memoDatabase() {
  return fakeDatabase({
    company: [
      { id: "company-1", baseCurrencyCode: "USD", companyGroupId: "group-1" }
    ],
    currency: [{ code: "USD", companyGroupId: "group-1", decimalPlaces: 2 }],
    account: [
      {
        id: "acct_returns",
        companyGroupId: "group-1",
        name: "Sales Returns & Allowances",
        number: "4200"
      }
    ],
    externalIntegrationMapping: accountMappingRows(
      { acct_returns: "4200" },
      "rillet"
    )
  });
}

/** `POST /products` stub, typed so `mock.calls` keeps its argument tuple. */
function makeCreateProduct() {
  return vi.fn(async (_payload: RilletProductWrite) => ({
    id: "rillet-product-uuid"
  }));
}

function setupCreditMemoSyncer(args: {
  memo: CreditMemoSource;
  /** Shared between syncers to carry the reason product's mapping across. */
  db?: ReturnType<typeof memoDatabase>;
  createProduct?: ReturnType<typeof makeCreateProduct>;
}) {
  const applyCreditMemo = vi.fn(
    async (_id: string, _applications: Rillet.CreditMemoApplication[]) =>
      undefined
  );
  const createCreditMemo = vi.fn(async (_payload: RilletCreditMemoCreate) => ({
    id: "rillet-credit-memo-1"
  }));
  const createProduct = args.createProduct ?? makeCreateProduct();

  const syncer = new RilletCreditMemoSyncer({
    database: (args.db ?? memoDatabase()).database,
    companyId: "company-1",
    entityType: "creditMemo",
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    provider: {
      id: "rillet",
      subsidiaryId: null,
      createCreditMemo,
      applyCreditMemo,
      createProduct
    } as never
  });

  vi.spyOn(syncer, "fetchLocal").mockResolvedValue(args.memo);
  (syncer as any).ensureDependencySynced = vi.fn(
    async (_type: string, localId: string) => `rillet-invoice-${localId}`
  );

  return { syncer, applyCreditMemo, createCreditMemo, createProduct };
}

describe("RilletCreditMemoSyncer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconciles TWO applications in ONE applications POST", async () => {
    const { syncer, applyCreditMemo, createCreditMemo } = setupCreditMemoSyncer(
      {
        memo: customerMemo({
          applications: [
            {
              id: "st_1",
              targetSalesInvoiceId: "si_1",
              targetPurchaseInvoiceId: null,
              amount: 150,
              appliedDate: "2026-09-22"
            },
            {
              id: "st_2",
              targetSalesInvoiceId: "si_2",
              targetPurchaseInvoiceId: null,
              amount: 100,
              appliedDate: "2026-09-23"
            }
          ]
        })
      }
    );

    expect(await syncer.pushToAccounting("memo_1")).toMatchObject({
      status: "success",
      remoteId: "rillet-credit-memo-1"
    });

    expect(createCreditMemo).toHaveBeenCalledTimes(1);
    // FULL RECONCILE: one call carrying BOTH entries. A second additive call
    // would delete the first call's application.
    expect(applyCreditMemo).toHaveBeenCalledTimes(1);
    expect(applyCreditMemo.mock.calls[0]?.[1]).toEqual([
      {
        invoice_id: "rillet-invoice-si_1",
        amount: { amount: "150.00", currency: "USD" },
        application_date: "2026-09-22"
      },
      {
        invoice_id: "rillet-invoice-si_2",
        amount: { amount: "100.00", currency: "USD" },
        application_date: "2026-09-23"
      }
    ]);
  });

  it("creates the reason product once and reuses it for a second memo", async () => {
    const db = memoDatabase();
    const createProduct = makeCreateProduct();

    const first = setupCreditMemoSyncer({
      memo: customerMemo(),
      db,
      createProduct
    });
    await first.syncer.pushToAccounting("memo_1");

    const second = setupCreditMemoSyncer({
      memo: customerMemo({ id: "memo_9", memoId: "CM-2026-0009" }),
      db,
      createProduct
    });
    await second.syncer.pushToAccounting("memo_9");

    expect(createProduct).toHaveBeenCalledTimes(1);
    expect(second.createCreditMemo).toHaveBeenCalledTimes(1);
    expect(second.createCreditMemo.mock.calls[0]?.[0]).toMatchObject({
      items: [{ price: { product_id: "rillet-product-uuid", quantity: 1 } }]
    });
  });

  it("skips a customer DEBIT memo with the v1 limitation as the reason", async () => {
    const { syncer, createCreditMemo } = setupCreditMemoSyncer({
      memo: customerMemo({ direction: "Debit" })
    });

    const result = await syncer.pushToAccounting("memo_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain(
      "Balance-increasing memos are not supported in v1"
    );
    expect(createCreditMemo).not.toHaveBeenCalled();
  });
});

function setupVendorCreditSyncer(memo: RilletMemoSource) {
  const createVendorCredit = vi.fn(
    async (_payload: RilletVendorCreditCreate) => ({ id: "rillet-vc-1" })
  );
  const applyVendorCredit = vi.fn(
    async (_id: string, _applications: Rillet.VendorCreditApplication[]) =>
      undefined
  );
  const syncer = new RilletVendorCreditSyncer({
    database: memoDatabase().database,
    companyId: "company-1",
    entityType: "supplierCredit",
    config: {
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    },
    provider: {
      id: "rillet",
      // Required on a vendor credit (optional on a credit memo and on bills).
      subsidiaryId: "rillet-subsidiary-uuid",
      createVendorCredit,
      applyVendorCredit
    } as never
  });
  vi.spyOn(syncer, "fetchLocal").mockResolvedValue(memo);
  (syncer as any).ensureDependencySynced = vi.fn(
    async (_type: string, localId: string) => `rillet-bill-${localId}`
  );
  return { syncer, createVendorCredit, applyVendorCredit };
}

describe("RilletVendorCreditSyncer", () => {
  const setup = setupVendorCreditSyncer;

  it("skips a supplier CREDIT memo with the v1 limitation as the reason", async () => {
    const { syncer, createVendorCredit } = setup(
      supplierMemo({ direction: "Credit" })
    );
    const result = await syncer.pushToAccounting("memo_2");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain(
      "Balance-increasing memos are not supported in v1"
    );
    expect(createVendorCredit).not.toHaveBeenCalled();
  });

  it("skips a CUSTOMER memo — each syncer owns only its own party", async () => {
    const { syncer, createVendorCredit } = setup(customerMemo());
    const result = await syncer.pushToAccounting("memo_1");
    expect(result.status).toBe("skipped");
    expect(result.error).toContain("customer memo");
    expect(createVendorCredit).not.toHaveBeenCalled();
  });

  it("pushes a supplier DEBIT memo and applies it to its bill in one call", async () => {
    const { syncer, createVendorCredit, applyVendorCredit } = setup(
      supplierMemo({
        applications: [
          {
            id: "st_3",
            targetSalesInvoiceId: null,
            targetPurchaseInvoiceId: "pi_1",
            amount: 250,
            appliedDate: "2026-09-22"
          }
        ]
      })
    );

    expect(await syncer.pushToAccounting("memo_2")).toMatchObject({
      status: "success",
      remoteId: "rillet-vc-1"
    });
    expect(createVendorCredit.mock.calls[0]?.[0]).toMatchObject({
      line_items: [
        { account_code: "4200", amount: { amount: "250.00", currency: "USD" } }
      ]
    });
    expect(applyVendorCredit).toHaveBeenCalledTimes(1);
    expect(applyVendorCredit.mock.calls[0]?.[1]).toEqual([
      {
        bill_id: "rillet-bill-pi_1",
        amount: { amount: "250.00", currency: "USD" }
      }
    ]);
  });
});

describe("the Posted gate (an unmapped VOIDED memo must not be created)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The sequence that used to reach Rillet: the memo is posted, its first push
   * fails (an unmapped reason account, say), the user VOIDS it, and the sweep
   * retries after the account is mapped. There is no mapping row, so
   * `pushToAccounting`'s void branch — which fires only on an EXISTING mapping
   * — is skipped, and a gate that deny-listed `Draft` alone let a Voided memo
   * through as a LIVE credit memo with its full application set.
   */
  it("skips a Voided memo that was never pushed, instead of creating it live", async () => {
    const { syncer, createCreditMemo, applyCreditMemo } = setupCreditMemoSyncer(
      {
        memo: customerMemo({
          status: "Voided",
          applications: [
            {
              id: "st_1",
              targetSalesInvoiceId: "si_1",
              targetPurchaseInvoiceId: null,
              amount: 250,
              appliedDate: "2026-09-22"
            }
          ]
        })
      }
    );

    const result = await syncer.pushToAccounting("memo_1");

    expect(result.status).toBe("skipped");
    expect(result.error).toContain("Voided");
    expect(createCreditMemo).not.toHaveBeenCalled();
    expect(applyCreditMemo).not.toHaveBeenCalled();
  });

  it("skips an unmapped Voided supplier credit too", async () => {
    const { syncer, createVendorCredit } = setupVendorCreditSyncer(
      supplierMemo({ status: "Voided" })
    );

    const result = await syncer.pushToAccounting("memo_2");

    expect(result.status).toBe("skipped");
    expect(result.error).toContain("Voided");
    expect(createVendorCredit).not.toHaveBeenCalled();
  });
});
