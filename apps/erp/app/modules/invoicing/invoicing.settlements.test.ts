// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import * as service from "./invoicing.service";

type Row = Record<string, any>;

// In-memory PostgREST fake. Rows omit columns a test does not care about, and a
// filter on an absent column (including embedded `payment.status` filters)
// passes, so these tests cover the arithmetic, not which rows a query selects.
function clientFor(
  tables: Record<string, Row[]>,
  failedPages: Record<string, number> = {}
) {
  const calls: {
    table: string;
    filters: [string, unknown][];
    idFilters: unknown[][];
  }[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        const call = {
          table,
          filters: [] as [string, unknown][],
          idFilters: [] as unknown[][]
        };
        calls.push(call);
        let result = tables[table] ?? [];
        let offset = 0;
        let end = 999;
        const q: any = {
          select: () => q,
          range: (start: number, last: number) => {
            offset = start;
            end = last;
            return q;
          },
          order: () => q,
          or: () => q,
          gt: () => q,
          eq: (key: string, value: unknown) => {
            call.filters.push([key, value]);
            result = result.filter(
              (r) => r[key] === undefined || r[key] === value
            );
            return q;
          },
          in: (key: string, values: unknown[]) => {
            call.idFilters.push(values);
            result = result.filter(
              (r) => r[key] === undefined || values.includes(r[key])
            );
            return q;
          },
          single: () =>
            Promise.resolve({ data: result[0] ?? null, error: null }),
          then: (done: any) =>
            Promise.resolve({
              data:
                failedPages[table] === offset
                  ? null
                  : result.slice(offset, end + 1),
              error:
                failedPages[table] === offset
                  ? { message: "Later page failed" }
                  : null
            }).then(done)
        };
        return q;
      }
    } as unknown as SupabaseClient<Database>
  };
}

// Kysely fake with the same leniency; records inserts and which tables were
// deleted from, so a refusal can be shown to write nothing.
function databaseFor(tables: Record<string, Row[]>) {
  const inserts: Row[] = [];
  const deletes: string[] = [];
  const db: any = {
    transaction: () => ({ execute: (fn: any) => fn(db) }),
    selectFrom: (table: string) => query(table),
    deleteFrom: (table: string) => query(table, "delete"),
    insertInto: (table: string) => query(table, "insert")
  };
  function query(table: string, mode = "select") {
    let rows = tables[table] ?? [];
    const q: any = {
      select: () => q,
      selectAll: () => q,
      forUpdate: () => q,
      orderBy: () => q,
      leftJoin: () => q,
      innerJoin: () => q,
      where: (column: unknown, op: string, value: unknown) => {
        if (typeof column === "string") {
          const key = column.split(".").at(-1)!;
          rows = rows.filter(
            (r) =>
              r[key] === undefined ||
              (op === "in"
                ? (value as unknown[]).includes(r[key])
                : op === "!="
                  ? r[key] !== value
                  : r[key] === value)
          );
        }
        return q;
      },
      values: (values: Row[]) => {
        inserts.push(...values);
        return q;
      },
      execute: async () => {
        if (mode === "delete") deletes.push(table);
        return rows;
      },
      executeTakeFirst: async () => rows[0]
    };
    return q;
  }
  return { db, inserts, deletes };
}

// 110 EUR received at 1.1 EUR per USD = 100 USD base.
const payment = {
  id: "prior",
  companyId: "co",
  customerId: "cust",
  paymentType: "Receipt",
  currencyCode: "EUR",
  status: "Posted",
  exchangeRate: 1.1,
  totalAmount: 110,
  postingDate: "2026-01-01",
  paymentDate: "2026-01-01"
};
const config = {
  company: [{ id: "co", companyGroupId: "group", baseCurrencyCode: "USD" }],
  currency: [{ code: "EUR", companyGroupId: "group", decimalPlaces: 2 }]
};
const current = {
  ...payment,
  id: "current",
  status: "Draft",
  totalAmount: 110,
  exchangeRate: 1.2
};
const invoice = {
  partyId: "cust",
  id: "invoice",
  companyId: "co",
  customerId: "cust",
  status: "Submitted",
  currencyCode: "EUR",
  exchangeRate: 1.1,
  totalAmount: 100,
  balance: 100,
  invoiceId: "INV1"
};
const draft = {
  targetSalesInvoiceId: "invoice",
  appliedAmount: 100,
  discountAmount: 0,
  writeOffAmount: 0,
  targetExchangeRate: 1.1,
  sourceExchangeRate: 1.2,
  sourceAmount: 110,
  appliedDate: "2026-09-07"
};
const memo = (overrides: Row = {}) => ({
  id: "memo",
  memoId: "CM1",
  companyId: "co",
  status: "Posted",
  direction: "Credit",
  customerId: "cust",
  supplierId: null,
  currencyCode: "EUR",
  exchangeRate: 1.1,
  amount: 55,
  ...overrides
});
// A settlement row as the open-invoice readers select it.
const settlement = (overrides: Row = {}) => ({
  paymentId: "posted",
  memoId: null,
  targetSalesInvoiceId: "invoice",
  sourceAmount: 1,
  appliedAmount: 1,
  discountAmount: 0,
  writeOffAmount: 0,
  payment: { status: "Posted" },
  memo: null,
  appliedViaPayment: null,
  ...overrides
});

function draftDb(overrides: Record<string, Row[]> = {}) {
  return databaseFor({
    ...config,
    payment: [current],
    salesInvoice: [invoice],
    salesInvoices: [invoice],
    ...overrides
  });
}
const replace = (
  db: unknown,
  applications: Parameters<
    typeof service.replaceInvoiceSettlements
  >[1]["applications"]
) =>
  service.replaceInvoiceSettlements(db as any, {
    paymentId: "current",
    companyId: "co",
    createdBy: "user",
    applications
  });
const applyCredits = (
  db: unknown,
  applications: Parameters<
    typeof service.applyCreditsToInvoices
  >[1]["applications"]
) =>
  service.applyCreditsToInvoices(db as any, {
    paymentId: "current",
    companyId: "co",
    createdBy: "user",
    side: "sales",
    appliedDate: "2026-09-07",
    applications
  });
const onAccountSources = (
  client: SupabaseClient<Database>,
  party: Parameters<typeof service.getAvailableOnAccountCreditSources>[2] = {
    paymentType: "Receipt",
    customerId: "cust"
  }
) => service.getAvailableOnAccountCreditSources(client, "co", party, "EUR");
const memoCredits = (
  client: SupabaseClient<Database>,
  excludePaymentId?: string
) =>
  service.getAvailableCreditsForParty(
    client,
    "co",
    { side: "sales", customerId: "cust" },
    excludePaymentId,
    "EUR"
  );
const openInvoices = (
  client: SupabaseClient<Database>,
  side: "sales" | "purchase" = "sales"
) =>
  side === "sales"
    ? service.getOpenSalesInvoicesForCustomer(client, "co", "cust", "EUR")
    : service.getOpenPurchaseInvoicesForSupplier(
        client,
        "co",
        "supplier",
        "EUR"
      );
const invoicesTable = (side: "sales" | "purchase") =>
  side === "sales" ? "salesInvoices" : "purchaseInvoices";
const companyScoped = (
  calls: ReturnType<typeof clientFor>["calls"],
  table: string
) =>
  calls
    .filter((c) => c.table === table)
    .every((c) => c.filters.some(([k, v]) => k === "companyId" && v === "co"));

describe("on-account credit sources", () => {
  it("reports the base total by dividing document cash by its rate", async () => {
    const { client } = clientFor({ ...config, payment: [payment] });
    expect(
      await service.getAvailableOnAccountCredit(client, "co", {
        paymentType: "Receipt",
        customerId: "cust"
      })
    ).toBe(100);
  });

  it("spends document credit and its recorded base release only once the applying payment posts", async () => {
    // Posted: 55 EUR consumed, base release 40 + 10 FX = 50. Draft reserves nothing.
    const { client, calls } = clientFor({
      ...config,
      payment: [
        payment,
        { ...payment, id: "applying", totalAmount: 0, exchangeRate: 1.2 }
      ],
      invoiceSettlement: [
        {
          paymentId: "applying",
          sourcePaymentId: "prior",
          sourceAmount: 55,
          appliedAmount: 40,
          fxGainLossAmount: 10,
          payment: { status: "Posted" }
        },
        {
          paymentId: "draft",
          sourcePaymentId: "prior",
          sourceAmount: 50,
          appliedAmount: 45,
          fxGainLossAmount: 0,
          payment: { status: "Draft" }
        }
      ]
    });
    expect(await onAccountSources(client)).toEqual({
      data: {
        sources: [
          {
            paymentId: "prior",
            postingDate: "2026-01-01",
            exchangeRate: 1.1,
            remainingDocument: 55,
            remainingBase: 50
          }
        ],
        availableDocumentAmount: 55,
        availableBaseAmount: 50
      },
      error: null
    });
    expect(companyScoped(calls, "payment")).toBe(true);
  });

  it("releases AP carrying base as applied minus FX", async () => {
    // 100 − (40 − (−10)) = 50.
    const { client } = clientFor({
      ...config,
      payment: [
        {
          ...payment,
          paymentType: "Disbursement",
          supplierId: "sup",
          customerId: null
        }
      ],
      invoiceSettlement: [
        {
          paymentId: "prior",
          sourcePaymentId: null,
          sourceAmount: 55,
          appliedAmount: 40,
          fxGainLossAmount: -10,
          payment: { status: "Posted" }
        }
      ]
    });
    const result = await onAccountSources(client, {
      paymentType: "Disbursement",
      supplierId: "sup"
    });
    expect(result.data?.availableBaseAmount).toBe(50);
  });

  it("keeps a positive minor unit whose carrying base rounds to zero", async () => {
    const { client } = clientFor({
      ...config,
      payment: [{ ...payment, totalAmount: 0.01, exchangeRate: 100000 }]
    });
    expect((await onAccountSources(client)).data?.sources[0]).toMatchObject({
      remainingDocument: 0.01,
      remainingBase: 0
    });
  });

  it("refuses when the currency has no configured precision", async () => {
    const { client } = clientFor({
      ...config,
      currency: [],
      payment: [payment]
    });
    expect((await onAccountSources(client)).error?.message).toMatch(
      /currency/i
    );
  });

  it("includes every posted source beyond the 1000-row response cap", async () => {
    const { client } = clientFor({
      ...config,
      payment: Array.from({ length: 1001 }, (_, i) => ({
        ...payment,
        id: `prior-${i}`
      }))
    });
    const result = await onAccountSources(client);
    expect(result.data?.sources).toHaveLength(1001);
    expect(result.data?.availableBaseAmount).toBe(100100);
    expect(result.data?.availableDocumentAmount).toBe(110110);
  });

  it("deducts consumption rows across pages", async () => {
    const { client } = clientFor({
      ...config,
      payment: [{ ...payment, totalAmount: 1002, exchangeRate: 1 }],
      invoiceSettlement: Array.from({ length: 1001 }, (_, i) => ({
        id: `s-${i}`,
        paymentId: "prior",
        sourcePaymentId: null,
        sourceAmount: 1,
        appliedAmount: 1,
        fxGainLossAmount: 0,
        payment: { status: "Posted" }
      }))
    });
    const result = await onAccountSources(client);
    expect(result.data?.availableDocumentAmount).toBe(1);
    expect(result.data?.availableBaseAmount).toBe(1);
  });
});

describe("memo credit availability", () => {
  it("reports 55 EUR at 1.1 as 50 base; a Draft reserves, a Voided releases, the caller's own staged rows stay available", async () => {
    const staged = (
      paymentId: string,
      status: string,
      sourceAmount: number,
      appliedAmount: number
    ) => ({
      memoId: "memo",
      sourceAmount,
      appliedAmount,
      appliedViaPaymentId: paymentId,
      appliedViaPayment: { status }
    });
    const { client } = clientFor({
      ...config,
      memo: [memo()],
      invoiceSettlement: [
        staged("draft", "Draft", 11, 10),
        staged("void", "Voided", 22, 20),
        staged("own", "Draft", 11, 10)
      ]
    });
    expect((await memoCredits(client, "own")).data?.[0]).toMatchObject({
      amount: 50,
      remaining: 40,
      remainingDocument: 44
    });
  });

  it("deducts posted consumption across pages", async () => {
    const { client } = clientFor({
      ...config,
      memo: [memo({ exchangeRate: 1, amount: 1002 })],
      invoiceSettlement: Array.from({ length: 1001 }, (_, i) => ({
        id: `s-${i}`,
        memoId: "memo",
        sourceAmount: 1,
        appliedAmount: 1,
        fxGainLossAmount: 0,
        appliedViaPaymentId: null
      }))
    });
    expect((await memoCredits(client)).data?.[0]).toMatchObject({
      remaining: 1,
      remainingDocument: 1
    });
  });

  it("reserves a refund's document principal without taking its FX from the memo's carrying base", async () => {
    // 55 − 22 = 33 EUR left; base 50 − 20 = 30, the 2.4 refund FX not deducted.
    const { client } = clientFor({
      ...config,
      memo: [memo()],
      invoiceSettlement: [
        {
          memoId: null,
          targetMemoId: "memo",
          paymentId: "refund",
          sourceAmount: 22,
          appliedAmount: 20,
          fxGainLossAmount: 2.4,
          payment: { status: "Posted" },
          appliedViaPaymentId: null
        }
      ]
    });
    expect((await memoCredits(client)).data?.[0]).toMatchObject({
      remainingDocument: 33,
      remaining: 30
    });
  });
});

describe("replaceInvoiceSettlements", () => {
  it.each([
    ["target rate", { ...draft, targetExchangeRate: 2 }],
    ["source rate", { ...draft, sourceExchangeRate: 2 }],
    ["funding source", { ...draft, sourcePaymentId: "forged" }]
  ])("rejects a forged %s before replacing drafts", async (_, app) => {
    const { db, deletes, inserts } = draftDb();
    await expect(replace(db, [app])).rejects.toThrow(/rate|source/i);
    expect(deletes).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("recomputes base principal and realized FX from the invoice and payment snapshots", async () => {
    // 110 EUR at 1.2 = 91.66667 base paid against 100 base billed: FX −8.33333.
    const { db, inserts } = draftDb();
    await replace(db, [draft]);
    expect(inserts).toEqual([
      expect.objectContaining({
        paymentId: "current",
        sourcePaymentId: null,
        sourceAmount: 110,
        appliedAmount: 100,
        fxGainLossAmount: -8.33333,
        sourceExchangeRate: 1.2,
        targetExchangeRate: 1.1
      })
    ]);
  });

  it.each([
    [
      "another currency",
      { salesInvoice: [{ ...invoice, currencyCode: "GBP" }] }
    ],
    ["no configured precision", { currency: [] }]
  ])("rejects an invoice in %s", async (_, overrides) => {
    const { db, inserts } = draftDb(overrides);
    await expect(replace(db, [draft])).rejects.toThrow(/currency|decimal/i);
    expect(inserts).toEqual([]);
  });

  it("refuses a principal finer than the currency's precision", async () => {
    const { db, deletes } = draftDb();
    await expect(
      replace(db, [{ ...draft, sourceAmount: 0.015, appliedAmount: 0.01364 }])
    ).rejects.toThrow(/precision/i);
    expect(deletes).toEqual([]);
  });

  it("funds a zero-cash draft from the prior payment at that payment's rate", async () => {
    const { db, inserts } = draftDb({
      payment: [{ ...current, totalAmount: 0 }, payment]
    });
    await replace(db, [draft]);
    expect(inserts[0]).toMatchObject({
      paymentId: "current",
      sourcePaymentId: "prior",
      sourceExchangeRate: 1.1,
      sourceAmount: 110,
      appliedAmount: 100,
      fxGainLossAmount: 0
    });
  });

  it("keeps the full document principal when its base rounds to zero", async () => {
    const tiny = {
      ...invoice,
      exchangeRate: 100000,
      totalAmount: 0.0000001,
      balance: 0.0000001
    };
    const { db, inserts } = draftDb({
      payment: [{ ...current, totalAmount: 0.01, exchangeRate: 100000 }],
      salesInvoice: [tiny],
      salesInvoices: [tiny]
    });
    await replace(db, [
      {
        ...draft,
        sourceAmount: 0.01,
        appliedAmount: 0,
        sourceExchangeRate: 100000,
        targetExchangeRate: 100000
      }
    ]);
    expect(inserts[0]).toMatchObject({ sourceAmount: 0.01, appliedAmount: 0 });
  });

  it("refuses to keep a staged credit whose memo was voided", async () => {
    const { db, deletes } = draftDb({
      invoiceSettlement: [
        {
          companyId: "co",
          memoId: "memo",
          paymentId: null,
          appliedViaPaymentId: "current",
          targetSalesInvoiceId: "invoice",
          sourceAmount: 11,
          appliedAmount: 10,
          discountAmount: 0,
          writeOffAmount: 0
        }
      ],
      memo: [memo({ status: "Voided" })]
    });
    await expect(
      replace(db, [{ ...draft, sourceAmount: 55, appliedAmount: 50 }])
    ).rejects.toThrow(/posted credit/i);
    expect(deletes).toEqual([]);
  });

  it("gives AP the opposite FX sign and applies the recorded control carrying amount", async () => {
    const payable = {
      ...invoice,
      customerId: undefined,
      supplierId: "sup",
      partyId: "sup",
      status: "Open"
    };
    const { db, inserts } = draftDb({
      payment: [
        {
          ...current,
          paymentType: "Disbursement",
          customerId: null,
          supplierId: "sup"
        }
      ],
      purchaseInvoice: [payable],
      purchaseInvoices: [payable],
      journalLine: [{ documentId: "invoice", amount: 100.00001 }]
    });
    await replace(db, [
      {
        ...draft,
        targetSalesInvoiceId: undefined,
        targetPurchaseInvoiceId: "invoice"
      }
    ]);
    expect(inserts[0]).toMatchObject({
      targetPurchaseInvoiceId: "invoice",
      appliedAmount: 100.00001,
      sourceAmount: 110,
      fxGainLossAmount: 8.33334
    });
  });
});

describe("memo refunds", () => {
  const refundMemo = (isAR: boolean, overrides: Row = {}) =>
    memo({
      customerId: isAR ? "cust" : null,
      supplierId: isAR ? null : "supplier",
      direction: isAR ? "Credit" : "Debit",
      ...overrides
    });
  const refund = {
    ...draft,
    targetSalesInvoiceId: undefined,
    targetMemoId: "memo",
    sourceAmount: 55,
    sourceExchangeRate: 1.25,
    appliedAmount: 50
  };

  it.each([true, false])(
    "stages a refund (customer: %s) against the exact memo principal with cash-direction FX",
    async (isAR) => {
      // 55 EUR at 1.25 = 44 base against 50 carrying: 6 in the cash direction.
      const { db, inserts } = draftDb({
        payment: [
          {
            ...current,
            paymentType: isAR ? "Disbursement" : "Receipt",
            customerId: isAR ? "cust" : null,
            supplierId: isAR ? null : "supplier",
            totalAmount: 55,
            exchangeRate: 1.25
          }
        ],
        memo: [refundMemo(isAR)],
        journalLine: [{ documentId: "memo", amount: -50 }]
      });
      await replace(db, [refund]);
      expect(inserts).toEqual([
        expect.objectContaining({
          targetMemoId: "memo",
          targetSalesInvoiceId: null,
          targetPurchaseInvoiceId: null,
          sourcePaymentId: null,
          sourceAmount: 55,
          appliedAmount: 50,
          fxGainLossAmount: isAR ? 6 : -6,
          createdBy: "user"
        })
      ]);
    }
  );

  it.each([
    ["party", { supplierId: "other" }, {}],
    ["currency", { currencyCode: "USD" }, {}],
    ["direction", { direction: "Credit" }, {}],
    ["memo status", { status: "Draft" }, {}],
    ["adjustments", {}, { discountAmount: 1 }],
    ["over-refund", {}, { sourceAmount: 56 }],
    [
      "invoice target",
      {},
      { targetMemoId: undefined, targetPurchaseInvoiceId: "invoice" }
    ]
  ])(
    "rejects a supplier refund with a bad %s without replacing applications",
    async (_, memoOverride, appOverride) => {
      const { db, inserts, deletes } = draftDb({
        payment: [
          {
            ...current,
            paymentType: "Receipt",
            customerId: null,
            supplierId: "supplier",
            totalAmount: 100,
            exchangeRate: 1.25
          }
        ],
        memo: [refundMemo(false, memoOverride)]
      });
      await expect(
        replace(db, [{ ...refund, ...appOverride }])
      ).rejects.toThrow();
      expect(inserts).toEqual([]);
      expect(deletes).toEqual([]);
    }
  );

  it("a fully refunded memo cannot also fund an invoice", async () => {
    const { db, inserts } = draftDb({
      payment: [{ ...current, totalAmount: 0, exchangeRate: 1.1 }],
      memo: [memo()],
      invoiceSettlement: [
        {
          memoId: null,
          targetMemoId: "memo",
          paymentId: "refund",
          sourceAmount: 55,
          appliedAmount: 50,
          fxGainLossAmount: 6
        }
      ]
    });
    await expect(
      applyCredits(db, [
        { memoId: "memo", invoiceId: "invoice", amount: 50, sourceAmount: 55 }
      ])
    ).rejects.toThrow(/remaining funding balance/);
    expect(inserts).toEqual([]);
  });
});

describe("applyCreditsToInvoices", () => {
  it("stores the exact memo document principal while applying the base amount", async () => {
    const { db, inserts } = draftDb({ memo: [memo()] });
    await applyCredits(db, [
      { memoId: "memo", invoiceId: "invoice", amount: 50 }
    ]);
    expect(inserts[0]).toMatchObject({
      memoId: "memo",
      appliedViaPaymentId: "current",
      appliedAmount: 50,
      sourceAmount: 55,
      sourceExchangeRate: 1.1,
      targetExchangeRate: 1.1
    });
  });

  it.each([
    ["a Draft", { status: "Draft" }],
    ["a Debit", { direction: "Debit" }],
    ["another currency's", { currencyCode: "GBP" }],
    ["another customer's", { customerId: "other" }]
  ])("rejects %s memo before replacing staged credits", async (_, invalid) => {
    const { db, deletes } = draftDb({ memo: [memo(invalid)] });
    await expect(
      applyCredits(db, [{ memoId: "memo", invoiceId: "invoice", amount: 50 }])
    ).rejects.toThrow();
    expect(deletes).toEqual([]);
  });

  it("rejects an amount over the memo's base balance", async () => {
    // 54 base is under 55 EUR but over the memo's 50 base.
    const { db } = draftDb({ memo: [memo()] });
    await expect(
      applyCredits(db, [{ memoId: "memo", invoiceId: "invoice", amount: 54 }])
    ).rejects.toThrow(/funding|balance/i);
  });

  it("keeps same-rate memo FX zero when the target releases its posted rounding residual", async () => {
    const { db, inserts } = draftDb({
      memo: [memo({ amount: 110 })],
      journalLine: [{ documentId: "invoice", amount: 100.00001 }]
    });
    await applyCredits(db, [
      { memoId: "memo", invoiceId: "invoice", amount: 100, sourceAmount: 110 }
    ]);
    expect(inserts[0]).toMatchObject({
      sourceAmount: 110,
      appliedAmount: 100.00001,
      fxGainLossAmount: 0
    });
  });

  it("saves a partial and then the final document cent with zero carrying base", async () => {
    const highRateInvoice = {
      ...invoice,
      totalAmount: 160.01 / 16000,
      exchangeRate: 16000
    };
    const tables = {
      payment: [{ ...current, totalAmount: 0, exchangeRate: 16000 }],
      salesInvoice: [highRateInvoice],
      salesInvoices: [highRateInvoice],
      memo: [
        memo({
          exchangeRate: 16000,
          amount: 160.01,
          memoDate: "2026-09-07",
          postingDate: "2026-09-07"
        })
      ],
      journalLine: [{ documentId: "invoice", amount: 0.01 }]
    };
    const partial = draftDb(tables);
    await applyCredits(partial.db, [
      { memoId: "memo", invoiceId: "invoice", amount: 0.01, sourceAmount: 160 }
    ]);
    expect(partial.inserts[0]).toMatchObject({
      appliedAmount: 0.01,
      sourceAmount: 160
    });
    const final = draftDb({
      ...tables,
      invoiceSettlement: [
        {
          ...partial.inserts[0],
          paymentId: null,
          appliedViaPaymentId: "posted",
          targetPurchaseInvoiceId: null,
          discountAmount: 0,
          writeOffAmount: 0
        }
      ]
    });
    await applyCredits(final.db, [
      { memoId: "memo", invoiceId: "invoice", amount: 0, sourceAmount: 0.01 }
    ]);
    expect(final.inserts[0]).toMatchObject({
      appliedAmount: 0,
      sourceAmount: 0.01,
      fxGainLossAmount: 0
    });
  });
});

describe("open invoices for the composer", () => {
  it("seeds each invoice from its original document total, ignoring a stale view balance", async () => {
    const { client } = clientFor({
      ...config,
      salesInvoices: [
        { ...invoice, totalAmount: 100, exchangeRate: 1.1, balance: 0 },
        {
          ...invoice,
          id: "two",
          totalAmount: 50,
          exchangeRate: 1.2,
          balance: 0
        },
        {
          ...invoice,
          id: "tiny",
          totalAmount: 0.0000001,
          exchangeRate: 100000,
          balance: 0
        }
      ]
    });
    const result = await openInvoices(client);
    expect(
      result.data?.map((i) => [i.id, i.balance, i.remainingDocument])
    ).toEqual([
      ["invoice", 100, 110],
      ["two", 50, 60],
      ["tiny", 0, 0.01]
    ]);
  });

  it("takes remaining base from the recorded control line, less effective settlements", async () => {
    const { client } = clientFor({
      ...config,
      salesInvoices: [
        { ...invoice, totalAmount: 0.000025, exchangeRate: 1000 }
      ],
      journalLine: [
        {
          documentId: "invoice",
          amount: 0.00004,
          journal: { status: "Posted" }
        }
      ],
      invoiceSettlement: [
        settlement({ sourceAmount: 0.01, appliedAmount: 0.00001 })
      ]
    });
    expect((await openInvoices(client)).data?.[0]).toMatchObject({
      balance: 0.00003,
      remainingDocument: 0.02
    });
  });

  it("reads a legacy settlement with no document principal from its applied base", async () => {
    const { client } = clientFor({
      ...config,
      salesInvoices: [{ ...invoice, totalAmount: 90, exchangeRate: 1 }],
      invoiceSettlement: [settlement({ sourceAmount: null })]
    });
    const result = await openInvoices(client);
    expect(result.error).toBeNull();
    expect(result.data?.[0]).toMatchObject({
      balance: 89,
      remainingDocument: 89
    });
  });

  it.each([
    ["an invalid principal of -1", { sourceAmount: -1 }, /principal/i],
    ["an invalid principal of NaN", { sourceAmount: Number.NaN }, /principal/i],
    [
      "settlements over the total instead of clamping",
      { sourceAmount: 91, appliedAmount: 91 },
      /excessive settlements/i
    ]
  ])("refuses %s", async (_, overrides, message) => {
    const { client } = clientFor({
      ...config,
      salesInvoices: [{ ...invoice, totalAmount: 90, exchangeRate: 1 }],
      invoiceSettlement: [settlement(overrides)]
    });
    const result = await openInvoices(client);
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(message);
  });

  it.each(["sales", "purchase"] as const)(
    "keeps signed %s control lines",
    async (side) => {
      const { client } = clientFor({
        ...config,
        [invoicesTable(side)]: [
          {
            ...invoice,
            status: side === "sales" ? "Submitted" : "Open",
            totalAmount: 90,
            exchangeRate: 1
          }
        ],
        journalLine: [
          { documentId: "invoice", amount: 100 },
          { documentId: "invoice", amount: -10 }
        ]
      });
      expect((await openInvoices(client, side)).data?.[0]).toMatchObject({
        balance: 90,
        remainingDocument: 90
      });
    }
  );

  it.each(["sales", "purchase"] as const)(
    "uses original intercompany %s controls and excludes VOID rows",
    async (side) => {
      const description = side === "sales" ? "IC Receivables" : "IC Payables";
      const { client } = clientFor({
        ...config,
        [invoicesTable(side)]: [
          {
            ...invoice,
            status: side === "sales" ? "Submitted" : "Open",
            totalAmount: 99,
            exchangeRate: 1
          }
        ],
        journalLine: [
          { documentId: "invoice", amount: 100, description },
          {
            documentId: "invoice",
            amount: -100,
            description: `VOID: ${description}`
          }
        ]
      });
      expect((await openInvoices(client, side)).data?.[0]).toMatchObject({
        balance: 100,
        remainingDocument: 99
      });
    }
  );

  it.each(["sales", "purchase"] as const)(
    "reads all %s settlements beyond the response cap",
    async (side) => {
      const { client } = clientFor({
        ...config,
        [invoicesTable(side)]: [
          {
            ...invoice,
            totalAmount: 1002,
            exchangeRate: 1,
            balance: 1,
            status: "Partially Paid"
          }
        ],
        journalLine: [{ documentId: "invoice", amount: 1002 }],
        invoiceSettlement: Array.from({ length: 1001 }, (_, index) =>
          settlement({ id: `s${index}`, targetPurchaseInvoiceId: "invoice" })
        )
      });
      const result = await openInvoices(client, side);
      expect(result.error).toBeNull();
      expect(result.data?.[0]).toMatchObject({
        balance: 1,
        remainingDocument: 1
      });
    }
  );

  it("reads every control line beyond the response cap", async () => {
    const { client } = clientFor({
      ...config,
      salesInvoices: [{ ...invoice, totalAmount: 1001, exchangeRate: 1 }],
      journalLine: Array.from({ length: 1001 }, (_, index) => ({
        id: `line${index}`,
        documentId: "invoice",
        amount: 1
      }))
    });
    expect((await openInvoices(client)).data?.[0]).toMatchObject({
      balance: 1001,
      remainingDocument: 1001
    });
  });

  // The gateway refuses long request lines, so id filters go in batches.
  it("reads every invoice with company-scoped id filters of at most 100", async () => {
    const invoices = Array.from({ length: 1001 }, (_, index) => ({
      ...invoice,
      id: `invoice${index}`,
      totalAmount: 3,
      exchangeRate: 1
    }));
    const { client, calls } = clientFor({
      ...config,
      salesInvoices: invoices,
      journalLine: invoices.map((i) => ({ documentId: i.id, amount: 3 })),
      invoiceSettlement: invoices.flatMap((i, index) =>
        [0, 1].map((n) =>
          settlement({ id: `s${index}-${n}`, targetSalesInvoiceId: i.id })
        )
      )
    });
    const result = await openInvoices(client);
    expect(result.data).toHaveLength(1001);
    expect(
      result.data?.every((i) => i.balance === 1 && i.remainingDocument === 1)
    ).toBe(true);
    for (const table of ["invoiceSettlement", "journalLine"]) {
      expect(companyScoped(calls, table)).toBe(true);
      expect(
        calls
          .filter((c) => c.table === table)
          .every((c) => c.idFilters.every((ids) => ids.length <= 100))
      ).toBe(true);
    }
  });

  it("refuses a partial balance when a later page fails", async () => {
    const { client } = clientFor(
      {
        ...config,
        salesInvoices: [{ ...invoice, totalAmount: 1002, exchangeRate: 1 }],
        invoiceSettlement: Array.from({ length: 1001 }, (_, index) =>
          settlement({ id: `s${index}` })
        )
      },
      { invoiceSettlement: 1000 }
    );
    expect(await openInvoices(client)).toEqual({
      data: null,
      error: { message: "Later page failed" }
    });
  });
});

describe("invoice settlement history", () => {
  const historyRow = (overrides: Row = {}) => ({
    id: "a",
    companyId: "co",
    paymentId: "posted",
    payment: { ...payment, id: "posted", paymentId: "PAY1" },
    memoId: null,
    targetSalesInvoiceId: "invoice",
    sourceAmount: 44,
    appliedAmount: 40,
    discountAmount: 0,
    writeOffAmount: 0,
    fxGainLossAmount: -3.33333,
    targetExchangeRate: 1.1,
    sourceExchangeRate: 1.2,
    appliedDate: "2026-09-07",
    appliedViaPaymentId: null,
    ...overrides
  });
  const history = (client: SupabaseClient<Database>) =>
    service.getInvoiceSettlementsForInvoice(client, "co", "sales", "invoice");

  it("sums funding splits under the applying payment and leaves out draft activity", async () => {
    const { client, calls } = clientFor({
      invoiceSettlement: [
        historyRow(),
        historyRow({
          id: "b",
          sourceAmount: 66,
          appliedAmount: 60,
          fxGainLossAmount: 0,
          sourceExchangeRate: 1.1
        }),
        historyRow({
          id: "c",
          paymentId: "draft",
          payment: { ...payment, status: "Draft" }
        }),
        historyRow({
          id: "d",
          paymentId: null,
          payment: null,
          memo: { id: "memo", companyId: "co", status: "Posted" },
          appliedViaPayment: { status: "Draft" },
          memoId: "memo",
          appliedViaPaymentId: "draft"
        })
      ],
      payment: [
        { ...payment, id: "posted", paymentId: "PAY1" },
        { ...payment, id: "draft", status: "Draft" }
      ],
      memo: [{ id: "memo", companyId: "co", status: "Posted" }]
    });
    const result = await history(client);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      appliedAmount: 100,
      sourceAmount: 110,
      fxGainLossAmount: -3.33333
    });
    expect(companyScoped(calls, "invoiceSettlement")).toBe(true);
  });

  it("rounds merged fractional document principal", async () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floating point.
    const { client } = clientFor({
      invoiceSettlement: [0.1, 0.2].map((amount, index) =>
        historyRow({
          id: `s${index}`,
          sourceAmount: amount,
          appliedAmount: amount,
          fxGainLossAmount: 0,
          targetExchangeRate: 1,
          sourceExchangeRate: 1
        })
      ),
      payment: [{ ...payment, id: "posted", paymentId: "PAY1" }]
    });
    expect((await history(client)).data?.[0]?.sourceAmount).toBe(0.3);
  });
});

it("changing a draft payment to a supplier clears its former customer", async () => {
  let saved: Row | undefined;
  const query: any = {
    update: (row: Row) => {
      saved = row;
      return query;
    },
    eq: () => query,
    select: () => query,
    single: async () => ({ data: { id: "current" }, error: null })
  };
  await service.upsertPayment({ from: () => query } as any, {
    id: "current",
    updatedBy: "user",
    paymentType: "Receipt",
    supplierId: "supplier",
    paymentDate: "2026-09-07",
    currencyCode: "EUR",
    exchangeRate: 1,
    totalAmount: 10,
    bankAccount: "bank"
  });
  expect(saved).toMatchObject({ customerId: null, supplierId: "supplier" });
});

describe("customer deposits fund only their own document", () => {
  const deposit = { ...payment, id: "deposit", rentalAgreementId: "ra-1" };
  const billsAgreement = (rentalAgreementId: string) => ({
    salesInvoiceLine: [
      {
        invoiceId: "invoice",
        companyId: "co",
        rentalAgreementId,
        salesOrderId: null
      }
    ]
  });

  it("does not draw a prior deposit for an invoice of another agreement", async () => {
    const { db, inserts, deletes } = draftDb({
      payment: [{ ...current, totalAmount: 0 }, deposit],
      ...billsAgreement("ra-3")
    });
    await expect(replace(db, [draft])).rejects.toThrow(
      "Insufficient payment funding for target: invoice"
    );
    expect(deletes).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("draws a prior deposit for an invoice that bills its agreement", async () => {
    const { db, inserts } = draftDb({
      payment: [{ ...current, totalAmount: 0 }, deposit],
      ...billsAgreement("ra-1")
    });
    await replace(db, [draft]);
    expect(inserts).toEqual([
      expect.objectContaining({
        sourcePaymentId: "deposit",
        sourceAmount: 110,
        appliedAmount: 100
      })
    ]);
  });

  it("refuses a deposit payment applied to another agreement's invoice", async () => {
    const { db, inserts } = draftDb({
      payment: [{ ...current, rentalAgreementId: "ra-1" }],
      rentalAgreement: [
        { id: "ra-1", companyId: "co", rentalAgreementId: "RA000001" }
      ],
      ...billsAgreement("ra-3")
    });
    await expect(replace(db, [draft])).rejects.toThrow(/RA000001/);
    expect(inserts).toEqual([]);
  });

  it("keeps deposits out of on-account totals but lists them with their scope", async () => {
    const { client } = clientFor({
      ...config,
      payment: [
        payment,
        {
          ...deposit,
          totalAmount: 55,
          depositAgreement: { readableId: "RA000001" },
          depositOrder: null
        }
      ]
    });
    const result = await onAccountSources(client);
    expect(result.data?.availableDocumentAmount).toBe(110);
    expect(result.data?.availableBaseAmount).toBe(100);
    expect(result.data?.sources[0]).not.toHaveProperty("scope");
    expect(result.data?.sources).toEqual([
      expect.objectContaining({ paymentId: "prior" }),
      expect.objectContaining({
        paymentId: "deposit",
        remainingDocument: 55,
        scope: { type: "rentalAgreement", id: "ra-1", readableId: "RA000001" }
      })
    ]);
    expect(
      await service.getAvailableOnAccountCredit(client, "co", {
        paymentType: "Receipt",
        customerId: "cust"
      })
    ).toBe(100);
  });

  it("lists the agreements and orders each open invoice bills", async () => {
    const { client } = clientFor({
      ...config,
      salesInvoices: [invoice],
      salesInvoiceLine: [
        { invoiceId: "invoice", rentalAgreementId: "ra-1", salesOrderId: null },
        {
          invoiceId: "invoice",
          rentalAgreementId: "ra-1",
          salesOrderId: "so-1"
        }
      ]
    });
    expect((await openInvoices(client)).data?.[0]).toMatchObject({
      rentalAgreementIds: ["ra-1"],
      salesOrderIds: ["so-1"]
    });
  });
});
