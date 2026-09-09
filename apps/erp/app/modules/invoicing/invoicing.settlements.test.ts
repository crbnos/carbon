import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: () => null,
  lookupEntry: () => null,
  hasEntry: () => false,
  termSlug: (s: string) => s,
  glossaryEntries: () => []
}));
vi.mock("~/modules/purchasing", () => ({}));
vi.mock("../people/people.service", () => ({}));
vi.mock("../sales/sales.service", () => ({}));
vi.mock("../accounting/accounting.ee.service", () => ({}));

import * as service from "./invoicing.service";

type Row = Record<string, any>;
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

describe("authoritative on-account sources", () => {
  it("keeps the existing base-total reader contract, dividing document cash by its snapshot", async () => {
    const { client } = clientFor({ ...config, payment: [payment] });
    expect(
      await service.getAvailableOnAccountCredit(client, "co", {
        paymentType: "Receipt",
        customerId: "cust"
      })
    ).toBe(100);
  });
  it("spends original document credit and its recorded base release only after applying payment posts", async () => {
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
    const result = await service.getAvailableOnAccountCreditSources(
      client,
      "co",
      { paymentType: "Receipt", customerId: "cust" },
      "EUR"
    );
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
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
    });
    expect(
      calls
        .filter((c) => c.table === "payment")
        .every((c) =>
          c.filters.some(([k, v]) => k === "companyId" && v === "co")
        )
    ).toBe(true);
  });
  it("uses AP applied minus FX for carrying release", async () => {
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
    const result = await service.getAvailableOnAccountCreditSources(
      client,
      "co",
      { paymentType: "Disbursement", supplierId: "sup" },
      "EUR"
    );
    expect(result.data?.availableBaseAmount).toBe(50);
  });
  it("retains a positive minor unit with zero carrying base and rejects missing precision", async () => {
    const { client } = clientFor({
      ...config,
      payment: [{ ...payment, totalAmount: 0.01, exchangeRate: 100000 }]
    });
    expect(
      (
        await service.getAvailableOnAccountCreditSources(
          client,
          "co",
          { paymentType: "Receipt", customerId: "cust" },
          "EUR"
        )
      ).data?.sources[0]
    ).toMatchObject({ remainingDocument: 0.01, remainingBase: 0 });
    const missing = clientFor({ ...config, currency: [], payment: [payment] });
    expect(
      (
        await service.getAvailableOnAccountCreditSources(
          missing.client,
          "co",
          { paymentType: "Receipt", customerId: "cust" },
          "EUR"
        )
      ).error?.message
    ).toMatch(/currency/i);
  });
});

describe("memo credit readers", () => {
  it("reports 55 EUR at 1.1 as 50 base; Draft reserves, Voided releases, own staged rows remain visible", async () => {
    const { client } = clientFor({
      ...config,
      memo: [
        {
          id: "memo",
          memoId: "CM1",
          direction: "Credit",
          companyId: "co",
          customerId: "cust",
          status: "Posted",
          currencyCode: "EUR",
          exchangeRate: 1.1,
          amount: 55
        }
      ],
      invoiceSettlement: [
        {
          memoId: "memo",
          sourceAmount: 11,
          appliedAmount: 10,
          appliedViaPaymentId: "draft",
          appliedViaPayment: { status: "Draft" }
        },
        {
          memoId: "memo",
          sourceAmount: 22,
          appliedAmount: 20,
          appliedViaPaymentId: "void",
          appliedViaPayment: { status: "Voided" }
        },
        {
          memoId: "memo",
          sourceAmount: 11,
          appliedAmount: 10,
          appliedViaPaymentId: "own",
          appliedViaPayment: { status: "Draft" }
        }
      ]
    });
    const result = await service.getAvailableCreditsForParty(
      client,
      "co",
      { side: "sales", customerId: "cust" },
      "own",
      "EUR"
    );
    expect(result.data?.[0]).toMatchObject({
      amount: 50,
      remaining: 40,
      remainingDocument: 44
    });
  });
});

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
function draftDb(overrides: Record<string, Row[]> = {}) {
  return databaseFor({
    ...config,
    payment: [current],
    salesInvoice: [invoice],
    salesInvoices: [invoice],
    ...overrides
  });
}
describe("replaceInvoiceSettlements transaction", () => {
  it.each([
    ["target rate", { ...draft, targetExchangeRate: 2 }],
    ["source rate", { ...draft, sourceExchangeRate: 2 }],
    ["funding source", { ...draft, sourcePaymentId: "forged" }]
  ])("rejects a forged %s before replacing drafts", async (_label, app) => {
    const { db, deletes, inserts } = draftDb();
    await expect(
      service.replaceInvoiceSettlements(db, {
        paymentId: "current",
        companyId: "co",
        createdBy: "user",
        applications: [app]
      })
    ).rejects.toThrow(/rate|source/i);
    expect(deletes).toEqual([]);
    expect(inserts).toEqual([]);
  });
  it("recomputes base principal and realized FX from authoritative invoice/payment snapshots", async () => {
    const { db, inserts } = draftDb();
    await service.replaceInvoiceSettlements(db, {
      paymentId: "current",
      companyId: "co",
      createdBy: "user",
      applications: [draft]
    });
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
  it("rejects another currency and missing configured precision", async () => {
    for (const overrides of [
      { salesInvoice: [{ ...invoice, currencyCode: "GBP" }] },
      { currency: [] }
    ] as Record<string, Row[]>[]) {
      const { db, inserts } = draftDb(overrides);
      await expect(
        service.replaceInvoiceSettlements(db, {
          paymentId: "current",
          companyId: "co",
          createdBy: "user",
          applications: [draft]
        })
      ).rejects.toThrow(/currency|decimal/i);
      expect(inserts).toEqual([]);
    }
  });
  it("allocates a zero-cash draft from the prior payment without repricing it", async () => {
    const { db, inserts } = draftDb({
      payment: [{ ...current, totalAmount: 0 }, payment]
    });
    await service.replaceInvoiceSettlements(db, {
      paymentId: "current",
      companyId: "co",
      createdBy: "user",
      applications: [draft]
    });
    expect(inserts[0]).toMatchObject({
      paymentId: "current",
      sourcePaymentId: "prior",
      sourceExchangeRate: 1.1,
      sourceAmount: 110,
      appliedAmount: 100,
      fxGainLossAmount: 0
    });
  });
  it("retains full document principal after base precision rounds to zero", async () => {
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
    await service.replaceInvoiceSettlements(db, {
      paymentId: "current",
      companyId: "co",
      createdBy: "user",
      applications: [
        {
          ...draft,
          sourceAmount: 0.01,
          appliedAmount: 0,
          sourceExchangeRate: 100000,
          targetExchangeRate: 100000
        }
      ]
    });
    expect(inserts[0]).toMatchObject({ sourceAmount: 0.01, appliedAmount: 0 });
  });
});

describe("composer invoice balances", () => {
  it("seeds two invoice snapshots from each original document total, independent of an old dust-forgiven view balance", async () => {
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
    const result = await service.getOpenSalesInvoicesForCustomer(
      client,
      "co",
      "cust",
      "EUR"
    );
    expect(
      result.data?.map((i) => [i.id, i.balance, i.remainingDocument])
    ).toEqual([
      ["invoice", 100, 110],
      ["two", 50, 60],
      ["tiny", 0, 0.01]
    ]);
  });
  it("uses recorded per-line control rounding and effective settlements for remaining base", async () => {
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
        {
          targetSalesInvoiceId: "invoice",
          paymentId: "posted",
          memoId: null,
          sourceAmount: 0.01,
          appliedAmount: 0.00001,
          discountAmount: 0,
          writeOffAmount: 0,
          payment: { status: "Posted" },
          memo: null,
          appliedViaPayment: null
        }
      ]
    });
    const result = await service.getOpenSalesInvoicesForCustomer(
      client,
      "co",
      "cust",
      "EUR"
    );
    expect(result.data?.[0]).toMatchObject({
      balance: 0.00003,
      remainingDocument: 0.02
    });
  });
});

describe("memo application save", () => {
  const memo = {
    id: "memo",
    companyId: "co",
    status: "Posted",
    direction: "Credit",
    customerId: "cust",
    supplierId: null,
    currencyCode: "EUR",
    exchangeRate: 1.1,
    amount: 55
  };
  it("stores exact memo document principal while applying base amount", async () => {
    const { db, inserts } = draftDb({ memo: [memo] });
    await service.applyCreditsToInvoices(db, {
      paymentId: "current",
      companyId: "co",
      createdBy: "user",
      side: "sales",
      appliedDate: "2026-09-07",
      applications: [{ memoId: "memo", invoiceId: "invoice", amount: 50 }]
    });
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
    { ...memo, status: "Draft" },
    { ...memo, direction: "Debit" },
    { ...memo, currencyCode: "GBP" },
    { ...memo, customerId: "other" }
  ])("rejects an ineligible memo before replacing staged credits", async (invalid) => {
    const { db, deletes } = draftDb({ memo: [invalid] });
    await expect(
      service.applyCreditsToInvoices(db, {
        paymentId: "current",
        companyId: "co",
        createdBy: "user",
        side: "sales",
        appliedDate: "2026-09-07",
        applications: [{ memoId: "memo", invoiceId: "invoice", amount: 50 }]
      })
    ).rejects.toThrow();
    expect(deletes).toEqual([]);
  });
  it("rejects base overdraw that the former document-number cap accepted", async () => {
    const { db } = draftDb({ memo: [memo] });
    await expect(
      service.applyCreditsToInvoices(db, {
        paymentId: "current",
        companyId: "co",
        createdBy: "user",
        side: "sales",
        appliedDate: "2026-09-07",
        applications: [{ memoId: "memo", invoiceId: "invoice", amount: 54 }]
      })
    ).rejects.toThrow(/funding|balance/i);
  });
});

describe("invoice history", () => {
  it("aggregates funding splits under the applying payment, excludes draft/voided activity, and scopes parents", async () => {
    const app = {
      id: "a",
      companyId: "co",
      paymentId: "posted",
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
      appliedViaPaymentId: null
    };
    const { client, calls } = clientFor({
      invoiceSettlement: [
        app,
        {
          ...app,
          id: "b",
          sourceAmount: 66,
          appliedAmount: 60,
          fxGainLossAmount: 0,
          sourceExchangeRate: 1.1
        },
        { ...app, id: "c", paymentId: "draft" },
        {
          ...app,
          id: "d",
          paymentId: null,
          memoId: "memo",
          appliedViaPaymentId: "draft"
        }
      ],
      payment: [
        { ...payment, id: "posted", paymentId: "PAY1" },
        { ...payment, id: "draft", status: "Draft" }
      ],
      memo: [{ id: "memo", companyId: "co", status: "Posted" }]
    });
    const result = await service.getInvoiceSettlementsForInvoice(
      client,
      "co",
      "sales",
      "invoice"
    );
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      appliedAmount: 100,
      sourceAmount: 110,
      fxGainLossAmount: -3.33333
    });
    expect(
      calls
        .filter((c) => c.table === "payment" || c.table === "memo")
        .every((c) =>
          c.filters.some(
            ([key, value]) => key === "companyId" && value === "co"
          )
        )
    ).toBe(true);
  });
});

it("refuses a draft principal finer than configured document precision", async () => {
  const { db, deletes } = draftDb();
  await expect(
    service.replaceInvoiceSettlements(db, {
      paymentId: "current",
      companyId: "co",
      createdBy: "user",
      applications: [{ ...draft, sourceAmount: 0.015, appliedAmount: 0.01364 }]
    })
  ).rejects.toThrow(/precision/i);
  expect(deletes).toEqual([]);
});

it("does not retain a staged credit whose memo has been voided", async () => {
  const staged = {
    companyId: "co",
    memoId: "memo",
    paymentId: null,
    appliedViaPaymentId: "current",
    targetSalesInvoiceId: "invoice",
    sourceAmount: 11,
    appliedAmount: 10,
    discountAmount: 0,
    writeOffAmount: 0
  };
  const { db, deletes } = draftDb({
    invoiceSettlement: [staged],
    memo: [
      {
        id: "memo",
        status: "Voided",
        currencyCode: "EUR",
        exchangeRate: 1.1,
        customerId: "cust",
        direction: "Credit"
      }
    ]
  });
  await expect(
    service.replaceInvoiceSettlements(db, {
      paymentId: "current",
      companyId: "co",
      createdBy: "user",
      applications: [{ ...draft, sourceAmount: 55, appliedAmount: 50 }]
    })
  ).rejects.toThrow(/posted credit/i);
  expect(deletes).toEqual([]);
});

it("normalizes AP with the opposite FX sign and recorded control carrying amount", async () => {
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
  await service.replaceInvoiceSettlements(db, {
    paymentId: "current",
    companyId: "co",
    createdBy: "user",
    applications: [
      {
        ...draft,
        targetSalesInvoiceId: undefined,
        targetPurchaseInvoiceId: "invoice"
      }
    ]
  });
  expect(inserts[0]).toMatchObject({
    targetPurchaseInvoiceId: "invoice",
    appliedAmount: 100.00001,
    sourceAmount: 110,
    fxGainLossAmount: 8.33334
  });
});

describe("financial reader pagination", () => {
  it("includes every posted source beyond the default 1000 row response", async () => {
    const { client } = clientFor({
      ...config,
      payment: Array.from({ length: 1001 }, (_, i) => ({
        ...payment,
        id: `prior-${i}`
      }))
    });
    const result = await service.getAvailableOnAccountCreditSources(
      client,
      "co",
      { paymentType: "Receipt", customerId: "cust" },
      "EUR"
    );
    expect(result.data?.sources).toHaveLength(1001);
    expect(result.data?.availableBaseAmount).toBe(100100);
    expect(result.data?.availableDocumentAmount).toBe(110110);
  });
  it("deducts all effective consumption rows across pages", async () => {
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
    const result = await service.getAvailableOnAccountCreditSources(
      client,
      "co",
      { paymentType: "Receipt", customerId: "cust" },
      "EUR"
    );
    expect(result.data?.availableDocumentAmount).toBe(1);
    expect(result.data?.availableBaseAmount).toBe(1);
  });
  it("includes all posted memo credit consumption when determining availability", async () => {
    const { client } = clientFor({
      ...config,
      memo: [
        {
          id: "memo",
          memoId: "CM1",
          direction: "Credit",
          companyId: "co",
          customerId: "cust",
          status: "Posted",
          currencyCode: "EUR",
          exchangeRate: 1,
          amount: 1002
        }
      ],
      invoiceSettlement: Array.from({ length: 1001 }, (_, i) => ({
        id: `s-${i}`,
        memoId: "memo",
        sourceAmount: 1,
        appliedAmount: 1,
        fxGainLossAmount: 0,
        appliedViaPaymentId: null
      }))
    });
    const result = await service.getAvailableCreditsForParty(
      client,
      "co",
      { side: "sales", customerId: "cust" },
      undefined,
      "EUR"
    );
    expect(result.data?.[0]).toMatchObject({
      remaining: 1,
      remainingDocument: 1
    });
  });
});

it("keeps same-rate memo FX zero when the target releases its posted rounding residual", async () => {
  const { db, inserts } = draftDb({
    memo: [
      {
        id: "memo",
        companyId: "co",
        status: "Posted",
        direction: "Credit",
        customerId: "cust",
        supplierId: null,
        currencyCode: "EUR",
        exchangeRate: 1.1,
        amount: 110
      }
    ],
    journalLine: [{ documentId: "invoice", amount: 100.00001 }]
  });
  await service.applyCreditsToInvoices(db, {
    paymentId: "current",
    companyId: "co",
    createdBy: "user",
    side: "sales",
    appliedDate: "2026-09-07",
    applications: [
      { memoId: "memo", invoiceId: "invoice", amount: 100, sourceAmount: 110 }
    ]
  });
  expect(inserts[0]).toMatchObject({
    sourceAmount: 110,
    appliedAmount: 100.00001,
    fxGainLossAmount: 0
  });
});

describe("complete composer source reads", () => {
  const application = {
    paymentId: "posted",
    memoId: null,
    targetSalesInvoiceId: "invoice",
    targetPurchaseInvoiceId: "invoice",
    sourceAmount: 1,
    appliedAmount: 1,
    discountAmount: 0,
    writeOffAmount: 0,
    payment: { status: "Posted" },
    memo: null,
    appliedViaPayment: null
  };
  it.each([
    "sales",
    "purchase"
  ] as const)("reads all %s settlements beyond the response cap", async (side) => {
    const { client } = clientFor({
      ...config,
      [side === "sales" ? "salesInvoices" : "purchaseInvoices"]: [
        {
          ...invoice,
          totalAmount: 1002,
          exchangeRate: 1,
          balance: 1,
          status: "Partially Paid"
        }
      ],
      journalLine: [{ documentId: "invoice", amount: 1002 }],
      invoiceSettlement: Array.from({ length: 1001 }, (_, index) => ({
        ...application,
        id: `s${index}`
      }))
    });
    const result =
      side === "sales"
        ? await service.getOpenSalesInvoicesForCustomer(
            client,
            "co",
            "cust",
            "EUR"
          )
        : await service.getOpenPurchaseInvoicesForSupplier(
            client,
            "co",
            "supplier",
            "EUR"
          );
    expect(result.error).toBeNull();
    expect(result.data?.[0]).toMatchObject({
      balance: 1,
      remainingDocument: 1
    });
  });
  it("reads every original control line beyond the response cap", async () => {
    const { client } = clientFor({
      ...config,
      salesInvoices: [{ ...invoice, totalAmount: 1001, exchangeRate: 1 }],
      journalLine: Array.from({ length: 1001 }, (_, index) => ({
        id: `line${index}`,
        documentId: "invoice",
        amount: 1
      }))
    });
    const result = await service.getOpenSalesInvoicesForCustomer(
      client,
      "co",
      "cust",
      "EUR"
    );
    expect(result.data?.[0]).toMatchObject({
      balance: 1001,
      remainingDocument: 1001
    });
  });
  it("reads every invoice and bounds contributing ID filters across an ordinary invoice batch", async () => {
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
        [0, 1].map((n) => ({
          ...application,
          id: `s${index}-${n}`,
          targetSalesInvoiceId: i.id
        }))
      )
    });
    const result = await service.getOpenSalesInvoicesForCustomer(
      client,
      "co",
      "cust",
      "EUR"
    );
    expect(result.data).toHaveLength(1001);
    expect(
      result.data?.every((i) => i.balance === 1 && i.remainingDocument === 1)
    ).toBe(true);
    const contributing = calls.filter(
      (c) => c.table === "invoiceSettlement" || c.table === "journalLine"
    );
    expect(
      contributing.every((c) => c.idFilters.every((ids) => ids.length <= 100))
    ).toBe(true);
    expect(
      contributing.every((c) =>
        c.filters.some(([key, value]) => key === "companyId" && value === "co")
      )
    ).toBe(true);
  });
  it("refuses a partial balance if a later contributing page fails", async () => {
    const { client } = clientFor(
      {
        ...config,
        salesInvoices: [{ ...invoice, totalAmount: 1002, exchangeRate: 1 }],
        invoiceSettlement: Array.from({ length: 1001 }, (_, index) => ({
          ...application,
          id: `s${index}`
        }))
      },
      { invoiceSettlement: 1000 }
    );
    const result = await service.getOpenSalesInvoicesForCustomer(
      client,
      "co",
      "cust",
      "EUR"
    );
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("Later page failed");
  });
});

it("rounds merged fractional document principal in invoice history", async () => {
  const { client } = clientFor({
    invoiceSettlement: [0.1, 0.2].map((amount, index) => ({
      id: `s${index}`,
      companyId: "co",
      paymentId: "posted",
      memoId: null,
      targetSalesInvoiceId: "invoice",
      sourceAmount: amount,
      appliedAmount: amount,
      discountAmount: 0,
      writeOffAmount: 0,
      fxGainLossAmount: 0,
      targetExchangeRate: 1,
      sourceExchangeRate: 1,
      appliedDate: "2026-09-07",
      appliedViaPaymentId: null
    })),
    payment: [{ ...payment, id: "posted", paymentId: "PAY1" }]
  });
  const result = await service.getInvoiceSettlementsForInvoice(
    client,
    "co",
    "sales",
    "invoice"
  );
  expect(result.data?.[0]?.sourceAmount).toBe(0.3);
});

it("saves a manual memo partial and then its final document cent with zero carrying base", async () => {
  const highRateInvoice = {
    ...invoice,
    totalAmount: 160.01 / 16000,
    exchangeRate: 16000
  };
  const memo = {
    id: "memo",
    companyId: "co",
    status: "Posted",
    direction: "Credit",
    customerId: "cust",
    supplierId: null,
    currencyCode: "EUR",
    exchangeRate: 16000,
    amount: 160.01,
    memoDate: "2026-09-07",
    postingDate: "2026-09-07"
  };
  const tables = {
    payment: [{ ...current, totalAmount: 0, exchangeRate: 16000 }],
    salesInvoice: [highRateInvoice],
    salesInvoices: [highRateInvoice],
    memo: [memo],
    journalLine: [{ documentId: "invoice", amount: 0.01 }]
  };
  const args = {
    paymentId: "current",
    companyId: "co",
    createdBy: "user",
    side: "sales" as const,
    appliedDate: "2026-09-07"
  };
  const partial = draftDb(tables);
  await service.applyCreditsToInvoices(partial.db, {
    ...args,
    applications: [
      { memoId: "memo", invoiceId: "invoice", amount: 0.01, sourceAmount: 160 }
    ]
  });
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
  await service.applyCreditsToInvoices(final.db, {
    ...args,
    applications: [
      { memoId: "memo", invoiceId: "invoice", amount: 0, sourceAmount: 0.01 }
    ]
  });
  expect(final.inserts[0]).toMatchObject({
    appliedAmount: 0,
    sourceAmount: 0.01,
    fxGainLossAmount: 0
  });
});

it.each([
  "sales",
  "purchase"
] as const)("preserves signed original %s controls", async (side) => {
  const { client } = clientFor({
    ...config,
    [side === "sales" ? "salesInvoices" : "purchaseInvoices"]: [
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
  const result =
    side === "sales"
      ? await service.getOpenSalesInvoicesForCustomer(
          client,
          "co",
          "cust",
          "EUR"
        )
      : await service.getOpenPurchaseInvoicesForSupplier(
          client,
          "co",
          "supplier",
          "EUR"
        );
  expect(result.data?.[0]).toMatchObject({
    balance: 90,
    remainingDocument: 90
  });
});

it.each([
  null,
  -1,
  Number.NaN
])("refuses invalid effective invoice principal %s", async (sourceAmount) => {
  const { client } = clientFor({
    ...config,
    salesInvoices: [{ ...invoice, totalAmount: 90, exchangeRate: 1 }],
    invoiceSettlement: [
      {
        paymentId: "posted",
        memoId: null,
        targetSalesInvoiceId: "invoice",
        sourceAmount,
        appliedAmount: 1,
        discountAmount: 0,
        writeOffAmount: 0,
        payment: { status: "Posted" },
        memo: null,
        appliedViaPayment: null
      }
    ]
  });
  const result = await service.getOpenSalesInvoicesForCustomer(
    client,
    "co",
    "cust",
    "EUR"
  );
  expect(result.data).toBeNull();
  expect(result.error?.message).toMatch(/principal/i);
});
it("refuses excess invoice settlements instead of silently clamping the balance", async () => {
  const { client } = clientFor({
    ...config,
    salesInvoices: [{ ...invoice, totalAmount: 90, exchangeRate: 1 }],
    invoiceSettlement: [
      {
        paymentId: "posted",
        memoId: null,
        targetSalesInvoiceId: "invoice",
        sourceAmount: 91,
        appliedAmount: 91,
        discountAmount: 0,
        writeOffAmount: 0,
        payment: { status: "Posted" },
        memo: null,
        appliedViaPayment: null
      }
    ]
  });
  const result = await service.getOpenSalesInvoicesForCustomer(
    client,
    "co",
    "cust",
    "EUR"
  );
  expect(result.data).toBeNull();
  expect(result.error?.message).toMatch(/excessive settlements/i);
});

it.each([
  "sales",
  "purchase"
] as const)("uses original IC %s controls and excludes VOID rows", async (side) => {
  const description = side === "sales" ? "IC Receivables" : "IC Payables";
  const { client } = clientFor({
    ...config,
    [side === "sales" ? "salesInvoices" : "purchaseInvoices"]: [
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
  const result =
    side === "sales"
      ? await service.getOpenSalesInvoicesForCustomer(
          client,
          "co",
          "cust",
          "EUR"
        )
      : await service.getOpenPurchaseInvoicesForSupplier(
          client,
          "co",
          "supplier",
          "EUR"
        );
  expect(result.data?.[0]).toMatchObject({
    balance: 100,
    remainingDocument: 99
  });
});
