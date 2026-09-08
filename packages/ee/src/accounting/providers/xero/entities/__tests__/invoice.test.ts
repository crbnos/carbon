import { describe, expect, it } from "vitest";
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
        taxPercent: 0,
        lineAmount: 100
      }
    ],
    updatedAt: "2026-08-04T00:00:00.000Z"
  }) as unknown as Accounting.SalesInvoice;

function makeInvoiceDb(config: {
  accountDefault: { salesAccount: string | null };
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
  (syncer as unknown as Record<string, unknown>).ensureDependencySynced =
    async (type: string) => `${type}-remote`;
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
    // 40 EUR/ea, not the 50 base
    expect(payload.LineItems[0]?.UnitAmount).toBe(40);
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
