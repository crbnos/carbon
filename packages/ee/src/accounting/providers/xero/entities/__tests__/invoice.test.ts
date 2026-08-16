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
