import { describe, expect, it, vi } from "vitest";
import type { Accounting } from "../../../../core/types";
import type { Xero } from "../../models";
import { SalesInvoiceSyncer } from "../invoice";

/**
 * Item-referenced AR invoices post to the item's mapped REVENUE account
 * (accountDefault.salesAccount → account-mapping externalCode) — the same
 * resolution that feeds Rillet's product account_code and QBO's
 * IncomeAccountRef. There is no blunt default-account-code fallback: when
 * the company default is unset or unmapped, mapToRemote throws the
 * structured UNMAPPED_ACCOUNTS Warning instead. COGS stays on the shipment
 * journal.
 */

const invoice = (): Accounting.SalesInvoice =>
  ({
    id: "si_1",
    invoiceId: "INV000001",
    companyId: "company-1",
    customerId: "cust-1",
    customerExternalId: null,
    status: "Pending",
    currencyCode: "USD",
    baseCurrencyCode: "USD",
    baseCurrencyDecimalPlaces: 2,
    currencyDecimalPlaces: 2,
    headerShippingCost: 0,
    shippingRevenueAccountId: "acct_shipping",
    exchangeRate: 1,
    dateIssued: "2026-08-04",
    dateDue: null,
    datePaid: null,
    customerReference: null,
    subtotal: 100,
    totalTax: 0,
    totalDiscount: 0,
    totalAmount: 100,
    balance: 100,
    lines: [
      {
        id: "sil-1",
        invoiceLineType: "Part",
        itemId: "item-1",
        itemCode: "WIDGET-1",
        description: "Widget",
        quantity: 2,
        unitPrice: 50,
        shippingCost: 0,
        addOnCost: 0,
        nonTaxableAddOnCost: 0,
        taxPercent: 0,
        lineAmount: 100
      }
    ],
    updatedAt: "2026-08-04T00:00:00.000Z"
  }) as unknown as Accounting.SalesInvoice;

function makeInvoiceDb(config: {
  accountDefault: {
    salesAccount: string | null;
    salesShippingRevenueAccount?: string | null;
  };
  accountMappings: Array<{
    id: string;
    accountId: string;
    externalId: string | null;
    metadata: unknown;
    lastSyncedAt: string | null;
    accountNumber: string | null;
    accountName: string | null;
  }>;
}) {
  const makeBuilder = (table: string) => {
    const builder: any = {
      select: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      orderBy: () => builder,
      async execute() {
        if (table === "externalIntegrationMapping as m")
          return config.accountMappings;
        return [];
      },
      async executeTakeFirst() {
        if (table === "accountDefault") return config.accountDefault;
        if (table === "account as a")
          return {
            id: config.accountDefault.salesShippingRevenueAccount,
            class: "Revenue",
            active: true,
            isGroup: false
          };
        return undefined;
      }
    };
    return builder;
  };
  return { selectFrom: (t: string) => makeBuilder(t) } as never;
}

function makeInvoiceSyncer(db: never) {
  const syncer = new SalesInvoiceSyncer({
    database: db,
    companyId: "company-1",
    provider: {
      id: "xero"
    } as never,
    config: { enabled: true, direction: "two-way", owner: "carbon" },
    entityType: "invoice"
  });
  (syncer as unknown as Record<string, unknown>).getRemoteId = async () => null;
  (syncer as unknown as Record<string, unknown>).ensureDependencySynced = vi.fn(
    async (type: string) => `${type}-remote`
  );
  return syncer as unknown as {
    mapToRemote(local: Accounting.SalesInvoice): Promise<Xero.Invoice>;
  };
}

describe("SalesInvoiceSyncer.mapToRemote (item revenue account)", () => {
  it("posts to the mapped sales account", async () => {
    const payload = await makeInvoiceSyncer(
      makeInvoiceDb({
        accountDefault: { salesAccount: "acct_sales" },
        accountMappings: [
          {
            id: "m-1",
            accountId: "acct_sales",
            externalId: "sales-remote",
            metadata: { externalCode: "4000" },
            lastSyncedAt: null,
            accountNumber: "4000",
            accountName: "Sales Revenue"
          }
        ]
      })
    ).mapToRemote(invoice());

    expect(payload.LineItems[0]?.AccountCode).toBe("4000");
    // Item still referenced; tax handling unchanged (Exclusive + NONE at 0 tax).
    expect(payload.LineItems[0]?.ItemCode).toBe("WIDGET-1");
    expect(payload.LineItems[0]?.TaxType).toBe("NONE");
    expect(payload.LineAmountTypes).toBe("Exclusive");
  });

  it("throws the structured UNMAPPED_ACCOUNTS warning when the company has no default sales account", async () => {
    const syncer = makeInvoiceSyncer(
      makeInvoiceDb({
        accountDefault: { salesAccount: null },
        accountMappings: []
      })
    );

    await expect(syncer.mapToRemote(invoice())).rejects.toMatchObject({
      name: "JournalEntrySyncError",
      failure: expect.objectContaining({ errorCode: "UNMAPPED_ACCOUNTS" })
    });
  });

  it("throws the structured UNMAPPED_ACCOUNTS warning when the default sales account has no Xero mapping", async () => {
    const syncer = makeInvoiceSyncer(
      makeInvoiceDb({
        accountDefault: { salesAccount: "acct_sales" },
        accountMappings: []
      })
    );

    await expect(syncer.mapToRemote(invoice())).rejects.toMatchObject({
      name: "JournalEntrySyncError",
      failure: expect.objectContaining({ errorCode: "UNMAPPED_ACCOUNTS" })
    });
  });
});

/**
 * Foreign-currency AR. `salesInvoiceLine.unitPrice` is stored in the company
 * BASE currency (`convertedUnitPrice` is the document mirror), so a payload
 * declaring `CurrencyCode: "EUR"` must carry EUR amounts, not the base ones.
 *
 * Xero's `CurrencyRate` runs the SAME direction as Carbon's
 * `currency.exchangeRate`: foreign per base. Xero's multicurrency guide is
 * explicit — "The units of CurrencyRate are always [Foreign Currency] PER
 * [Base Currency] ... A CurrencyRate of 1.10 for a EUR invoice against a
 * GBP-base-currency organisation says that 1 GBP = 1.1 EUR." So the rate is
 * passed through unchanged; inverting it triggers Xero's "inverse rate"
 * warning and books base amounts wrong.
 */
const fxInvoice = (): Accounting.SalesInvoice =>
  ({
    ...invoice(),
    currencyCode: "EUR",
    // 0.80 EUR per 1 USD of base -- Xero's units exactly
    exchangeRate: 0.8,
    subtotal: 100,
    totalAmount: 100,
    balance: 100,
    lines: [
      {
        id: "sil-1",
        invoiceLineType: "Part",
        itemId: "item-1",
        itemCode: "WIDGET-1",
        description: "Widget",
        quantity: 2,
        // base currency: 2 x 50 = 100 base, i.e. 80 EUR
        unitPrice: 50,
        convertedUnitPrice: 40,
        shippingCost: 0,
        addOnCost: 0,
        nonTaxableAddOnCost: 0,
        taxPercent: 0,
        lineAmount: 100
      }
    ]
  }) as unknown as Accounting.SalesInvoice;

describe("SalesInvoiceSyncer.mapToRemote (foreign currency)", () => {
  const db = () =>
    makeInvoiceDb({
      accountDefault: { salesAccount: "acct_sales" },
      accountMappings: [
        {
          id: "m-1",
          accountId: "acct_sales",
          externalId: "sales-remote",
          metadata: { externalCode: "4000" },
          lastSyncedAt: null,
          accountNumber: "4000",
          accountName: "Sales Revenue"
        }
      ]
    });

  it("pushes line amounts in the currency the payload declares", async () => {
    const payload = await makeInvoiceSyncer(db()).mapToRemote(fxInvoice());
    expect(payload.CurrencyCode).toBe("EUR");
    // One monetary unit carries the full 80 EUR net; source detail remains.
    expect(payload.LineItems[0]?.UnitAmount).toBe(80);
    expect(payload.LineItems[0]?.Description).toContain("2 × 40 EUR");
    expect(payload.LineItems[0]?.LineAmount).toBe(80);
  });

  it("passes CurrencyRate through unchanged (foreign per base, both sides)", async () => {
    const payload = await makeInvoiceSyncer(db()).mapToRemote(fxInvoice());
    // Xero wants EUR per USD, which is what Carbon already stores. Sending the
    // reciprocal (1.25) is the documented "inverse rate" mistake.
    expect(payload.CurrencyRate).toBeCloseTo(0.8, 6);
  });

  it("omits CurrencyRate on a base-currency invoice rather than sending 1", async () => {
    const payload = await makeInvoiceSyncer(db()).mapToRemote(invoice());
    // Xero: "Setting a CurrencyRate of 1 is redundant and considered incorrect."
    expect(payload.CurrencyRate).toBeUndefined();
  });
});

const mappedAccounts = [
  {
    id: "sales-map",
    accountId: "acct_sales",
    externalId: "sales-remote",
    metadata: { externalCode: "4000" },
    lastSyncedAt: null,
    accountNumber: "4000",
    accountName: "Sales"
  },
  {
    id: "shipping-map",
    accountId: "acct_shipping",
    externalId: "shipping-remote",
    metadata: { externalCode: "4010" },
    lastSyncedAt: null,
    accountNumber: "4010",
    accountName: "Shipping"
  }
];
function chargedInvoice(): Accounting.SalesInvoice {
  const source = invoice();
  return {
    ...source,
    currencyCode: "EUR",
    exchangeRate: 0.8,
    headerShippingCost: 5,
    shippingRevenueAccountId: "acct_shipping",
    subtotal: 133,
    totalTax: 13,
    totalAmount: 151,
    balance: 151,
    lines: [
      {
        ...source.lines[0]!,
        quantity: 1,
        unitPrice: 100,
        convertedUnitPrice: 80,
        shippingCost: 10,
        addOnCost: 20,
        nonTaxableAddOnCost: 3,
        taxPercent: 0.1
      }
    ]
  };
}
describe("Xero native sales components", () => {
  it("maps sales/shipping separately and sends fractional native tax exactly once in document currency", async () => {
    const syncer = makeInvoiceSyncer(
      makeInvoiceDb({
        accountDefault: {
          salesAccount: "acct_sales",
          salesShippingRevenueAccount: "acct_shipping"
        },
        accountMappings: mappedAccounts
      })
    );
    const payload = await syncer.mapToRemote(chargedInvoice());
    expect(payload).toMatchObject({
      SubTotal: 110.4,
      TotalTax: 10.4,
      Total: 120.8,
      AmountDue: 120.8,
      CurrencyCode: "EUR",
      CurrencyRate: 0.8,
      LineAmountTypes: "Exclusive"
    });
    expect(
      payload.LineItems.map((line) => [
        line.AccountCode,
        line.LineAmount,
        line.TaxAmount,
        line.TaxType
      ])
    ).toEqual([
      ["4000", 80, 8, "OUTPUT"],
      ["4000", 16, 1.6, "OUTPUT"],
      ["4000", 2.4, 0, "NONE"],
      ["4010", 8, 0.8, "OUTPUT"],
      ["4010", 4, 0, "NONE"]
    ]);
  });
  it("preflights unmapped shipping before customer/item provisioning", async () => {
    const syncer = makeInvoiceSyncer(
      makeInvoiceDb({
        accountDefault: {
          salesAccount: "acct_sales",
          salesShippingRevenueAccount: "acct_shipping"
        },
        accountMappings: mappedAccounts.slice(0, 1)
      })
    );
    await expect(syncer.mapToRemote(chargedInvoice())).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
    expect(
      (syncer as unknown as { ensureDependencySynced: unknown })
        .ensureDependencySynced
    ).not.toHaveBeenCalled();
  });
});

function reviewSyncer() {
  const database = makeInvoiceDb({
    accountDefault: {
      salesAccount: "acct_sales",
      salesShippingRevenueAccount: "acct_replacement"
    },
    accountMappings: [
      ...mappedAccounts,
      {
        ...mappedAccounts[1]!,
        id: "replacement-map",
        accountId: "acct_replacement",
        metadata: { externalCode: "4050" }
      }
    ]
  });
  return makeInvoiceSyncer(database);
}
describe("Xero posted facts and monetary representation", () => {
  it("keeps the posted shipping account after changing defaults", async () => {
    const source = Object.assign(chargedInvoice(), {
      shippingRevenueAccountId: "acct_shipping"
    });
    const payload = await reviewSyncer().mapToRemote(source);
    expect(
      payload.LineItems.filter((line) =>
        line.Description?.startsWith("Shipping")
      ).map((line) => line.AccountCode)
    ).toEqual(["4010", "4010"]);
  });
  it("represents bulk native tax against a monetary unit without losing the source quantity", async () => {
    const source = invoice();
    source.totalTax = 10;
    source.totalAmount = 110;
    source.balance = 110;
    source.lines[0] = {
      ...source.lines[0]!,
      quantity: 100,
      unitPrice: 1,
      taxPercent: 0.1
    };
    const payload = await reviewSyncer().mapToRemote(source);
    expect(payload.LineItems[0]).toMatchObject({
      Quantity: 1,
      UnitAmount: 100,
      LineAmount: 100,
      TaxAmount: 10
    });
    expect(payload.LineItems[0]?.Description).toContain("100 × 1 USD");
  });
  it("refuses subcent document principal before dependency writes", async () => {
    const source = invoice();
    source.currencyDecimalPlaces = 3;
    source.subtotal = 1.001;
    source.totalAmount = 1.001;
    source.balance = 1.001;
    source.lines[0] = { ...source.lines[0]!, quantity: 1, unitPrice: 1.001 };
    await expect(reviewSyncer().mapToRemote(source)).rejects.toThrow(
      /Xero.*precision|Xero.*decimal/i
    );
  });
  it("pins an explicit foreign 1:1 rate", async () => {
    const source = invoice();
    source.currencyCode = "EUR";
    expect((await reviewSyncer().mapToRemote(source)).CurrencyRate).toBe(1);
  });
  it.each([
    false,
    true
  ])("opts into supported unit precision at the actual invoice transport (batch=%s)", async (batch) => {
    const syncer = reviewSyncer();
    const requests: string[] = [];
    (syncer as any).provider.request = async (_method: string, url: string) => {
      requests.push(url);
      return { data: { Invoices: [{ InvoiceID: "remote" }] } };
    };
    const payload = await syncer.mapToRemote(invoice());
    if (batch)
      await (syncer as any).upsertRemoteBatch([{ localId: "si_1", payload }]);
    else await (syncer as any).upsertRemote(payload, "si_1");
    expect(requests).toEqual(["/Invoices?unitdp=4"]);
  });
});

it("preserves an exact extended net when the source unit price has four decimals", async () => {
  const source = fxInvoice();
  source.subtotal = 59.997;
  source.totalAmount = 59.997;
  source.balance = 59.997;
  source.lines[0] = {
    ...source.lines[0]!,
    quantity: 3,
    unitPrice: 19.999,
    convertedUnitPrice: 15.9992
  };
  const payload = await reviewSyncer().mapToRemote(source);
  expect(payload.LineItems[0]).toMatchObject({
    Quantity: 1,
    UnitAmount: 48,
    LineAmount: 48
  });
  expect(payload.LineItems[0]?.Description).toContain("3 × 15.9992 EUR");
  expect(payload.Total).toBe(48);
});
it("preserves a negative untaxed offset without increasing the invoice principal", async () => {
  const source = invoice();
  source.subtotal = 90;
  source.totalAmount = 90;
  source.balance = 90;
  source.lines.push({
    ...source.lines[0]!,
    id: "offset",
    quantity: 5,
    unitPrice: -2
  });
  const payload = await reviewSyncer().mapToRemote(source);
  expect(
    payload.LineItems.map((line) => [
      line.Quantity,
      line.UnitAmount,
      line.LineAmount,
      line.TaxAmount
    ])
  ).toEqual([
    [1, 100, 100, 0],
    [1, -10, -10, 0]
  ]);
  expect(payload.Total).toBe(90);
});
it("refuses missing original shipping provenance before provisioning", async () => {
  const source = chargedInvoice();
  source.shippingRevenueAccountId = null;
  const syncer = reviewSyncer();
  await expect(syncer.mapToRemote(source)).rejects.toMatchObject({
    failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
  });
  expect((syncer as any).ensureDependencySynced).not.toHaveBeenCalled();
});
