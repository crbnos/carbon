import { EPSILON, round } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { QboSalesInvoiceSyncer } from "../providers/quickbooks-online/entities/invoice";
import { RilletSalesInvoiceSyncer } from "../providers/rillet/entities/invoice";
import { SalesInvoiceSyncer } from "../providers/xero/entities/invoice";
import { SalesInvoiceSchema } from "./models";
import {
  assertNoAssetDisposalComponents,
  buildSalesDocumentComponents,
  hasRevenueComponent,
  isRevenueComponent
} from "./sales-document-components";
import {
  loadSalesInvoices,
  requirePostedSalesAccountId,
  requirePostedShippingAccountId
} from "./sales-invoice-source";
import type { Accounting } from "./types";

/**
 * The structured facts a parked operation keeps: `failOperation` records
 * `errorCode`/`warning` from `JournalEntrySyncError.failure`, and the invoice id
 * is what tells a reader WHICH document to open — which is the whole point of
 * raising per invoice rather than per batch.
 */
function failureOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    const failure = (error as { failure?: Record<string, unknown> }).failure;
    return {
      errorCode: failure?.errorCode,
      warning: failure?.warning,
      invoiceId: (failure?.metadata as { invoiceId?: string } | undefined)
        ?.invoiceId
    };
  }
  return null;
}

function fixture() {
  return {
    id: "invoice",
    invoiceId: "INV-1",
    companyId: "company",
    customerId: "customer",
    customerExternalId: null,
    status: "Submitted",
    currencyCode: "EUR",
    exchangeRate: 0.8,
    baseCurrencyCode: "USD",
    baseCurrencyDecimalPlaces: 2,
    currencyDecimalPlaces: 2,
    headerShippingCost: 5,
    shippingRevenueAccountId: "acct-shipping",
    salesRevenueAccountId: "acct-sales",
    dateIssued: "2026-09-07",
    dateDue: null,
    datePaid: null,
    customerReference: null,
    subtotal: 133,
    totalTax: 13,
    totalDiscount: 0,
    totalAmount: 151,
    balance: 151,
    updatedAt: "2026-09-07T00:00:00.000Z",
    lines: [
      {
        id: "line",
        invoiceLineType: "Service",
        itemId: "item",
        itemCode: "SERVICE",
        description: "Work",
        quantity: 1,
        unitPrice: 100,
        convertedUnitPrice: 80,
        shippingCost: 10,
        addOnCost: 20,
        nonTaxableAddOnCost: 3,
        taxPercent: 0.1,
        lineAmount: 100
      }
    ]
  };
}
const build = (source: ReturnType<typeof fixture>) =>
  buildSalesDocumentComponents(source as Accounting.SalesInvoice);

describe("buildSalesDocumentComponents", () => {
  it.each([
    1, 3
  ])("keeps provider quantity × unit price equal to reconciled net for quantity %i", (quantity) => {
    const source = fixture();
    source.currencyCode = "JPY";
    source.currencyDecimalPlaces = 0;
    source.lines[0]!.quantity = quantity;
    source.lines[0]!.unitPrice = 100 / quantity;
    source.lines[0]!.convertedUnitPrice = 80 / quantity;
    const document = build(source);
    // 100 base converts to exactly 80 at rate 0.8. The JPY rounding unit is
    // apportioned to the component with the largest fractional remainder (the
    // non-taxable add-on, exactly 2.4), not concentrated on merchandise.
    expect(document.components[0]?.netAmount).toBe(80);
    for (const component of document.components) {
      expect(
        round(component.quantity * component.unitAmount, document.decimalPlaces)
      ).toBe(component.netAmount);
    }
    expect(source.lines[0]!.convertedUnitPrice).toBe(80 / quantity);
  });

  it("exports base151 as document120.80 with net98.40 Sales, net12 Shipping and native tax10.40", () => {
    const result = build(fixture());
    expect(result).toMatchObject({
      invoiceId: "invoice",
      currencyCode: "EUR",
      decimalPlaces: 2,
      subtotal: 110.4,
      totalTax: 10.4,
      totalAmount: 120.8,
      balance: 120.8
    });
    expect(
      result.components.map(
        ({
          id,
          kind,
          netAmount,
          taxAmount,
          quantity,
          taxPercent,
          sourceLineId
        }) => ({
          id,
          kind,
          netAmount,
          taxAmount,
          quantity,
          taxPercent,
          sourceLineId
        })
      )
    ).toEqual([
      {
        id: "line:Merchandise",
        kind: "Merchandise",
        netAmount: 80,
        taxAmount: 8,
        quantity: 1,
        taxPercent: 0.1,
        sourceLineId: "line"
      },
      {
        id: "line:TaxableAddOn",
        kind: "TaxableAddOn",
        netAmount: 16,
        taxAmount: 1.6,
        quantity: 1,
        taxPercent: 0.1,
        sourceLineId: "line"
      },
      {
        id: "line:NonTaxableAddOn",
        kind: "NonTaxableAddOn",
        netAmount: 2.4,
        taxAmount: 0,
        quantity: 1,
        taxPercent: 0,
        sourceLineId: "line"
      },
      {
        id: "line:LineShipping",
        kind: "LineShipping",
        netAmount: 8,
        taxAmount: 0.8,
        quantity: 1,
        taxPercent: 0.1,
        sourceLineId: "line"
      },
      {
        id: "invoice:HeaderShipping",
        kind: "HeaderShipping",
        netAmount: 4,
        taxAmount: 0,
        quantity: 1,
        taxPercent: 0,
        sourceLineId: null
      }
    ]);
    expect(result.components[0]).toMatchObject({
      itemId: "item",
      itemCode: "SERVICE",
      description: "Work",
      unitAmount: 80
    });
    expect(
      result.components.find((line) => line.kind === "HeaderShipping")?.itemId
    ).toBeNull();
  });

  it("ignores comments and retains positive add-ons when merchandise quantity is zero", () => {
    const source = fixture();
    source.headerShippingCost = 0;
    source.subtotal = 20;
    source.totalTax = 2;
    source.totalAmount = 22;
    source.balance = 22;
    source.lines[0] = {
      ...source.lines[0]!,
      quantity: 0,
      shippingCost: 0,
      nonTaxableAddOnCost: 0
    };
    source.lines.push({
      ...source.lines[0]!,
      id: "comment",
      invoiceLineType: "Comment",
      quantity: 100,
      unitPrice: 100
    });
    const result = build(source);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      kind: "TaxableAddOn",
      netAmount: 16,
      taxAmount: 1.6,
      quantity: 1,
      itemId: "item"
    });
    expect(result.totalAmount).toBe(17.6);
  });

  it("exports a zero-weight header charge once with its invoice identity", () => {
    const source = fixture();
    source.headerShippingCost = 1;
    source.subtotal = 0;
    source.totalTax = 0;
    source.totalAmount = 1;
    source.balance = 1;
    source.lines = ["c", "a", "b"].map((id) => ({
      ...source.lines[0]!,
      id,
      quantity: 0,
      shippingCost: 0,
      addOnCost: 0,
      nonTaxableAddOnCost: 0
    }));
    const result = build(source);
    expect(result.components).toEqual([
      expect.objectContaining({
        id: "invoice:HeaderShipping",
        kind: "HeaderShipping",
        netAmount: 0.8,
        taxAmount: 0
      })
    ]);
    expect(result.totalAmount).toBe(0.8);
  });

  it.each([
    0, 3
  ])("honors %i-decimal document amounts and reconciles deterministic fractional residuals", (decimalPlaces) => {
    const source = fixture();
    source.currencyDecimalPlaces = decimalPlaces;
    source.currencyCode = decimalPlaces === 0 ? "JPY" : "BHD";
    source.headerShippingCost = 0;
    source.subtotal = 1;
    source.totalTax = 0;
    source.totalAmount = 1;
    source.balance = 0.5;
    source.lines = ["b", "c", "a"].map((id) => ({
      ...source.lines[0]!,
      id,
      unitPrice: 1 / 3,
      convertedUnitPrice: 0.8 / 3,
      shippingCost: 0,
      addOnCost: 0,
      nonTaxableAddOnCost: 0,
      taxPercent: 0
    }));
    const result = build(source);
    expect(result.totalAmount).toBe(decimalPlaces === 0 ? 1 : 0.8);
    expect(result.balance).toBe(decimalPlaces === 0 ? 0 : 0.4);
    expect(
      result.components.reduce((sum, line) => sum + line.netAmount, 0)
    ).toBeCloseTo(result.subtotal, decimalPlaces);
    const reversed = build({ ...source, lines: [...source.lines].reverse() });
    expect(
      Object.fromEntries(
        result.components.map((line) => [line.id, line.netAmount])
      )
    ).toEqual(
      Object.fromEntries(
        reversed.components.map((line) => [line.id, line.netAmount])
      )
    );
  });

  it("preserves merchandise quantity and the precise stored document unit mirror", () => {
    const source = fixture();
    source.headerShippingCost = 0;
    source.subtotal = 59.997;
    source.totalTax = 0;
    source.totalAmount = 59.997;
    source.balance = 59.997;
    source.lines[0] = {
      ...source.lines[0]!,
      quantity: 3,
      unitPrice: 19.999,
      convertedUnitPrice: 15.9992,
      shippingCost: 0,
      addOnCost: 0,
      nonTaxableAddOnCost: 0,
      taxPercent: 0
    };
    expect(build(source).components[0]).toMatchObject({
      quantity: 3,
      unitAmount: 15.9992,
      netAmount: 48
    });
  });

  it("rejects a document mirror that contradicts the stored FX snapshot", () => {
    const source = fixture();
    source.lines[0]!.convertedUnitPrice = 100;
    expect(() => build(source)).toThrow(/mirror|exchange/i);
  });

  it("rejects an otherwise scale-valid mirror when a large quantity makes it contradict document net", () => {
    const source = fixture();
    source.headerShippingCost = 0;
    source.subtotal = 1;
    source.totalTax = 0;
    source.totalAmount = 1;
    source.balance = 1;
    source.lines[0] = {
      ...source.lines[0]!,
      quantity: 100000,
      unitPrice: 0.00001,
      convertedUnitPrice: 0.00001,
      shippingCost: 0,
      addOnCost: 0,
      nonTaxableAddOnCost: 0,
      taxPercent: 0
    };
    // Stored base × rate implies EUR0.80, but the rounded mirror extends to EUR1.
    expect(() => build(source)).toThrow(/unit price.*reconcile/i);
  });

  it.each([
    "subtotal",
    "totalTax",
    "totalAmount"
  ] as const)("does not conceal an economic mismatch in authoritative %s", (field) => {
    const source = fixture();
    source[field] += 1;
    expect(() => build(source)).toThrow(/reconcil|total|tax|subtotal/i);
  });

  it.each([
    Number.NaN,
    0,
    -1,
    Number.POSITIVE_INFINITY
  ])("rejects invalid foreign-per-base rate %s", (rate) => {
    const source = fixture();
    source.exchangeRate = rate;
    expect(() => build(source)).toThrow(/rate|finite/i);
  });

  it("requires authoritative currency precision and an identity rate for the base currency", () => {
    const source = fixture();
    expect(() =>
      build({ ...source, currencyDecimalPlaces: Number.NaN })
    ).toThrow(/precision|decimal/i);
    expect(() => build({ ...source, currencyDecimalPlaces: -1 })).toThrow(
      /precision|decimal/i
    );
    expect(() => build({ ...source, baseCurrencyCode: "" })).toThrow(
      /currency/i
    );
    expect(() => build({ ...source, currencyCode: "USD" })).toThrow(
      /identity|rate/i
    );
  });

  it("omits zero components and rejects header shipping without a postable source line", () => {
    const source = fixture();
    source.headerShippingCost = 0;
    source.subtotal = 0;
    source.totalTax = 0;
    source.totalAmount = 0;
    source.balance = 0;
    source.lines = [];
    expect(build(source).components).toEqual([]);
    source.headerShippingCost = 5;
    source.totalAmount = 5;
    source.balance = 5;
    expect(() => build(source)).toThrow(/shipping.*line/i);
  });
});

describe("normalized sales invoice currency/component contract", () => {
  it("retains authoritative currency metadata and charge columns through parsing", () => {
    const parsed = SalesInvoiceSchema.parse(fixture());
    expect(parsed).toMatchObject({
      baseCurrencyCode: "USD",
      baseCurrencyDecimalPlaces: 2,
      currencyDecimalPlaces: 2,
      headerShippingCost: 5
    });
    expect(parsed.lines[0]).toMatchObject({
      shippingCost: 10,
      addOnCost: 20,
      nonTaxableAddOnCost: 3,
      convertedUnitPrice: 80
    });
  });
  it("defaults old normalized line charges to zero but rejects absent currency precision", () => {
    const source = fixture();
    const {
      shippingCost: _shipping,
      addOnCost: _addOn,
      nonTaxableAddOnCost: _nonTaxable,
      ...line
    } = source.lines[0]!;
    expect(
      SalesInvoiceSchema.parse({ ...source, lines: [line] }).lines[0]
    ).toMatchObject({ shippingCost: 0, addOnCost: 0, nonTaxableAddOnCost: 0 });
    const { currencyDecimalPlaces: _precision, ...withoutPrecision } = source;
    expect(SalesInvoiceSchema.safeParse(withoutPrecision).success).toBe(false);
  });
});

function sourceDatabase(
  missingCurrency = false,
  postingRows = [
    {
      documentId: "invoice",
      accountId: "posted-shipping",
      description: "Shipping Revenue",
      amount: 15,
      accountClass: "Revenue",
      isGroup: false
    }
  ],
  invoiceIds = ["invoice"]
) {
  const source = fixture();
  const headerValues: Record<string, unknown> = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [`salesInvoice.${key}`, value])
  );
  Object.assign(headerValues, {
    "salesInvoice.subtotal": 999,
    "salesInvoice.totalTax": 999,
    "salesInvoice.totalAmount": 999,
    "salesInvoices.subtotal": source.subtotal,
    "salesInvoices.totalTax": source.totalTax,
    "salesInvoices.totalAmount": source.totalAmount,
    "salesInvoices.balance": source.balance,
    "salesInvoiceShipment.shippingCost": source.headerShippingCost,
    "company.baseCurrencyCode": source.baseCurrencyCode,
    "baseCurrency.decimalPlaces": source.baseCurrencyDecimalPlaces,
    "documentCurrency.decimalPlaces": missingCurrency
      ? null
      : source.currencyDecimalPlaces
  });
  const lineValues: Record<string, unknown> = Object.fromEntries(
    Object.entries(source.lines[0]!).map(([key, value]) => [
      `salesInvoiceLine.${key}`,
      value
    ])
  );
  lineValues["salesInvoiceLine.invoiceId"] = source.id;
  lineValues["item.readableIdWithRevision"] = "SERVICE";
  const reads: Array<{
    table: string;
    columns: string[];
    where: unknown[][];
    joins: string[];
    on: unknown[][];
  }> = [];
  const database = {
    selectFrom(table: string) {
      const read = {
        table,
        columns: [] as string[],
        where: [] as unknown[][],
        joins: [] as string[],
        on: [] as unknown[][]
      };
      reads.push(read);
      const builder: any = {
        select(columns: string[] | string) {
          read.columns.push(...(Array.isArray(columns) ? columns : [columns]));
          return builder;
        },
        where(...args: unknown[]) {
          read.where.push(args);
          return builder;
        },
        leftJoin(name: string, ...args: unknown[]) {
          read.joins.push(name);
          if (typeof args[0] === "function") {
            const join: any = {
              onRef(...refs: unknown[]) {
                read.on.push(refs);
                return join;
              },
              on(...refs: unknown[]) {
                read.on.push(refs);
                return join;
              }
            };
            args[0](join);
          }
          return builder;
        },
        innerJoin(name: string, ...args: unknown[]) {
          return builder.leftJoin(name, ...args);
        },
        async execute() {
          if (table === "journalLine") return postingRows;
          const values = table === "salesInvoice" ? headerValues : lineValues;
          return invoiceIds.map((id) =>
            Object.fromEntries(
              read.columns.map((column) => {
                const [name, alias] = column.split(" as ");
                const value =
                  name === "salesInvoice.id" ||
                  name === "salesInvoiceLine.invoiceId"
                    ? id
                    : name === "salesInvoiceLine.id"
                      ? `line-${id}`
                      : values[name!];
                return [alias ?? name!.split(".").at(-1)!, value];
              })
            )
          );
        }
      };
      return builder;
    }
  };
  return { database, reads };
}
describe.each([
  SalesInvoiceSyncer,
  QboSalesInvoiceSyncer,
  RilletSalesInvoiceSyncer
])("provider source fetch %s", (Syncer) => {
  it("reads authoritative view totals, all charge columns and group-scoped currency metadata through the actual batch path", async () => {
    const { database, reads } = sourceDatabase();
    const syncer = new Syncer({
      database: database as never,
      companyId: "company",
      provider: { id: "xero" } as never,
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      },
      entityType: "invoice"
    });
    const result = await (
      syncer as unknown as {
        fetchLocalBatch(
          ids: string[]
        ): Promise<Map<string, Accounting.SalesInvoice>>;
      }
    ).fetchLocalBatch(["invoice"]);
    const source = result.get("invoice");
    expect(source).toMatchObject({
      subtotal: 133,
      totalTax: 13,
      totalAmount: 151,
      balance: 151,
      headerShippingCost: 5,
      shippingRevenueAccountId: "posted-shipping",
      baseCurrencyCode: "USD",
      baseCurrencyDecimalPlaces: 2,
      currencyDecimalPlaces: 2
    });
    expect(source?.lines[0]).toMatchObject({
      shippingCost: 10,
      addOnCost: 20,
      nonTaxableAddOnCost: 3,
      convertedUnitPrice: 80
    });
    expect(buildSalesDocumentComponents(source!)).toMatchObject({
      subtotal: 110.4,
      totalTax: 10.4,
      totalAmount: 120.8
    });
    expect(reads).toHaveLength(3);
    expect(reads[0]?.where).toContainEqual([
      "salesInvoice.companyId",
      "=",
      "company"
    ]);
    expect(reads[1]?.where).toContainEqual([
      "salesInvoiceLine.companyId",
      "=",
      "company"
    ]);
    expect(reads[0]?.on).toContainEqual([
      "documentCurrency.companyGroupId",
      "=",
      "company.companyGroupId"
    ]);
    expect(reads[0]?.on).toContainEqual([
      "baseCurrency.companyGroupId",
      "=",
      "company.companyGroupId"
    ]);
  });
  it("fails source loading when authoritative currency precision is unavailable", async () => {
    const { database } = sourceDatabase(true);
    const syncer = new Syncer({
      database: database as never,
      companyId: "company",
      provider: { id: "xero" } as never,
      config: {
        enabled: true,
        direction: "push-to-accounting",
        owner: "carbon"
      },
      entityType: "invoice"
    });
    await expect(syncer.fetchLocal("invoice")).rejects.toThrow(
      /currency|precision/i
    );
  });
});

describe("canonical invoice posting source", () => {
  it("keeps different original shipping accounts in one batch and scopes every posting read", async () => {
    const postings = ["a", "b"].map((id) => ({
      documentId: id,
      accountId: `shipping-${id}`,
      description: "Shipping Revenue",
      amount: 15,
      accountClass: "Revenue",
      isGroup: false
    }));
    const { database, reads } = sourceDatabase(false, postings, ["a", "b"]);
    const result = await loadSalesInvoices(database as never, {
      companyId: "company",
      ids: ["a", "b"]
    });
    expect(
      [...result.values()].map((invoice) => invoice.shippingRevenueAccountId)
    ).toEqual(["shipping-a", "shipping-b"]);
    const read = reads.find((read) => read.table === "journalLine")!;
    expect(read.where).toEqual(
      expect.arrayContaining([
        ["journalLine.companyId", "=", "company"],
        ["journal.companyId", "=", "company"],
        ["journal.sourceType", "=", "Sales Invoice"],
        ["journalLine.documentType", "=", "Invoice"],
        ["journal.status", "=", "Posted"],
        ["journalLine.documentId", "in", ["a", "b"]]
      ])
    );
    expect(read.on).toContainEqual([
      "account.companyGroupId",
      "=",
      "company.companyGroupId"
    ]);
    expect(reads.some((read) => read.table === "accountDefault")).toBe(false);
  });
  it("refuses ambiguous original shipping accounts without choosing today's default", async () => {
    const postings = ["a", "b"].map((id) => ({
      documentId: "invoice",
      accountId: `shipping-${id}`,
      description: "Shipping Revenue",
      amount: 15,
      accountClass: "Revenue",
      isGroup: false
    }));
    const { database } = sourceDatabase(false, postings);
    // The refusal is the invoice's own, raised where the account is USED — the
    // loader is a batch and must not fail its siblings. See the per-invoice
    // isolation suite below.
    const invoice = (
      await loadSalesInvoices(database as never, {
        companyId: "company",
        ids: ["invoice"]
      })
    ).get("invoice")!;
    expect(invoice.shippingRevenueAccountId).toBeNull();
    expect(failureOf(() => requirePostedShippingAccountId(invoice))).toEqual({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      invoiceId: "invoice"
    });
  });
  it("ignores reversal and arbitrary revenue descriptions as original shipping facts", async () => {
    const postings = ["VOID: Shipping Revenue", "Some revenue"].map(
      (description) => ({
        documentId: "invoice",
        accountId: "other",
        description,
        amount: 15,
        accountClass: "Revenue",
        isGroup: false
      })
    );
    const { database } = sourceDatabase(false, postings);
    expect(
      (
        await loadSalesInvoices(database as never, {
          companyId: "company",
          ids: ["invoice"]
        })
      ).get("invoice")?.shippingRevenueAccountId
    ).toBeNull();
  });
});

describe("replayed sales revenue account", () => {
  /**
   * The bug this exists to stop coming back: every test in this file used to post
   * only a "Shipping Revenue" line, so the whole SalesRevenue extraction could be
   * reverted to a shipping-only map and the suite stayed green — while every
   * provider fixture hand-set `salesRevenueAccountId` and hid it.
   */
  it("extracts the account the original journal credited for merchandise", async () => {
    const postings = [
      {
        documentId: "a",
        accountId: "sales-4000",
        description: "Sales Account",
        amount: 100,
        accountClass: "Revenue",
        isGroup: false
      },
      {
        documentId: "a",
        accountId: "shipping-4100",
        description: "Shipping Revenue",
        amount: 15,
        accountClass: "Revenue",
        isGroup: false
      }
    ];
    const { database } = sourceDatabase(false, postings, ["a"]);
    const result = await loadSalesInvoices(database as never, {
      companyId: "company",
      ids: ["a"]
    });
    const invoice = result.get("a")!;
    expect(invoice.salesRevenueAccountId).toBe("sales-4000");
    expect(invoice.shippingRevenueAccountId).toBe("shipping-4100");
  });

  it("refuses an invoice whose merchandise revenue hit two accounts", async () => {
    // Carbon posts ALL merchandise revenue to one account, so two means the
    // journal is not the shape this replay assumes and guessing would misstate.
    const postings = ["sales-4000", "sales-4001"].map((accountId) => ({
      documentId: "a",
      accountId,
      description: "Sales Account",
      amount: 50,
      accountClass: "Revenue",
      isGroup: false
    }));
    const { database } = sourceDatabase(false, postings, ["a"]);
    const invoice = (
      await loadSalesInvoices(database as never, {
        companyId: "company",
        ids: ["a"]
      })
    ).get("a")!;
    expect(invoice.salesRevenueAccountId).toBeNull();
    expect(failureOf(() => requirePostedSalesAccountId(invoice))).toEqual({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      invoiceId: "a"
    });
  });
});

/**
 * `loadSalesInvoices` is the batch loader behind every invoice syncer's
 * `fetchLocalBatch`. `pushBatchToAccounting` calls it ONCE for the whole claimed
 * group (`DEFAULT_CLAIM_LIMIT` = 20 operations) and its outer `catch` records
 * whatever the loader threw against EVERY id in the group — so a throw for one
 * invoice's malformed revenue posting parked up to 19 healthy posted invoices as
 * `Warning UNMAPPED_ACCOUNTS` naming a document they have nothing to do with.
 * Nothing automatic recovers them either: `shouldEnqueueMissingDocument` refuses
 * to re-enqueue a parked Warning, the capped re-drive arm in
 * `computeReconcileDecision` is `bill`-only, and the changed-since-failure retry
 * needs the invoice to be edited. One bad document therefore stopped AR sync for
 * its whole batch, permanently and silently.
 *
 * Before this branch only a *Shipping* Revenue row could reach those throws, so
 * an invoice with no shipping was immune. Replaying merchandise revenue put
 * every invoice on that path.
 */
describe("per-invoice revenue-account defects do not fail their batch", () => {
  const cleanPostings = (documentId: string) => [
    {
      documentId,
      accountId: "sales-4000",
      description: "Sales Account",
      amount: 100,
      accountClass: "Revenue",
      isGroup: false
    },
    {
      documentId,
      accountId: "shipping-4100",
      description: "Shipping Revenue",
      amount: 15,
      accountClass: "Revenue",
      isGroup: false
    }
  ];

  async function loadPair(
    badPostings: Array<Record<string, unknown>>
  ): Promise<Map<string, Accounting.SalesInvoice>> {
    const { database } = sourceDatabase(
      false,
      [...cleanPostings("good"), ...badPostings] as never,
      ["good", "bad"]
    );
    return loadSalesInvoices(database as never, {
      companyId: "company",
      ids: ["good", "bad"]
    });
  }

  function expectGoodInvoiceUnaffected(
    result: Map<string, Accounting.SalesInvoice>
  ) {
    const good = result.get("good")!;
    expect(requirePostedSalesAccountId(good)).toBe("sales-4000");
    expect(requirePostedShippingAccountId(good)).toBe("shipping-4100");
  }

  it("leaves a sibling invoice fully usable when merchandise revenue is ambiguous", async () => {
    const result = await loadPair(
      ["sales-4000", "sales-4001"].map((accountId) => ({
        documentId: "bad",
        accountId,
        description: "Sales Account",
        amount: 50,
        accountClass: "Revenue",
        isGroup: false
      }))
    );
    expectGoodInvoiceUnaffected(result);
    const bad = result.get("bad")!;
    expect(failureOf(() => requirePostedSalesAccountId(bad))).toEqual({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      invoiceId: "bad"
    });
  });

  it("leaves a sibling invoice fully usable when a merchandise posting is not a Revenue leaf", async () => {
    // A group account, and a non-Revenue class, were the two conditions that
    // threw from inside the posting-row loop — before the result map was even
    // built, so they took every invoice in the batch with them.
    const result = await loadPair([
      {
        documentId: "bad",
        accountId: "sales-parent",
        description: "Sales Account",
        amount: 100,
        accountClass: "Revenue",
        isGroup: true
      }
    ]);
    expectGoodInvoiceUnaffected(result);
    expect(result.get("bad")!.salesRevenueAccountId).toBeNull();
  });

  it("leaves a sibling invoice fully usable when a shipping posting is not a Revenue leaf", async () => {
    const result = await loadPair([
      ...cleanPostings("bad").slice(0, 1),
      {
        documentId: "bad",
        accountId: "shipping-asset",
        description: "Shipping Revenue",
        amount: 15,
        accountClass: "Asset",
        isGroup: false
      }
    ]);
    expectGoodInvoiceUnaffected(result);
    const bad = result.get("bad")!;
    // Only the broken ROLE is unresolved — the invoice's merchandise account is
    // still replayed, so a document with no shipping component still syncs.
    expect(bad.salesRevenueAccountId).toBe("sales-4000");
    expect(failureOf(() => requirePostedShippingAccountId(bad))).toEqual({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      invoiceId: "bad"
    });
  });

  it("does not fall back to the valid line when one posting of a role is unusable", async () => {
    // Half-broken is still broken: picking the surviving account would be the
    // guess the whole replay exists to avoid.
    const result = await loadPair([
      {
        documentId: "bad",
        accountId: "sales-parent",
        description: "Sales Account",
        amount: 40,
        accountClass: "Revenue",
        isGroup: true
      },
      {
        documentId: "bad",
        accountId: "sales-4000",
        description: "Sales Account",
        amount: 60,
        accountClass: "Revenue",
        isGroup: false
      }
    ]);
    expectGoodInvoiceUnaffected(result);
    expect(result.get("bad")!.salesRevenueAccountId).toBeNull();
  });
});

describe("fixed-asset disposal components", () => {
  /**
   * `post-sales-invoice` posts NO "Sales Account" line for a Fixed Asset line
   * (`sales-posting-amounts.ts`, `if (!isAsset)`) — the proceeds go to the
   * disposal accounts. Before `invoiceLineType` reached the component, a disposal
   * was indistinguishable from a part and every provider reported it as sales
   * revenue.
   */
  const assetComponent = {
    id: "line-1:Merchandise",
    sourceLineId: "line-1",
    kind: "Merchandise" as const,
    itemId: null,
    itemCode: null,
    invoiceLineType: "Fixed Asset",
    description: "Haas VF-2 disposal",
    quantity: 1,
    unitAmount: 5000,
    netAmount: 5000,
    taxPercent: 0,
    taxAmount: 0
  };
  const partComponent = {
    ...assetComponent,
    id: "line-2:Merchandise",
    sourceLineId: "line-2",
    invoiceLineType: "Part",
    description: "Bracket",
    unitAmount: 100,
    netAmount: 100
  };
  const document = (components: (typeof assetComponent)[]) => ({
    invoiceId: "a",
    currencyCode: "USD",
    decimalPlaces: 2,
    components,
    subtotal: 0,
    totalTax: 0,
    totalAmount: 0,
    balance: 0
  });

  it("does not count a disposal as revenue", () => {
    expect(isRevenueComponent(assetComponent)).toBe(false);
    expect(isRevenueComponent(partComponent)).toBe(true);
    expect(hasRevenueComponent([assetComponent])).toBe(false);
    expect(hasRevenueComponent([assetComponent, partComponent])).toBe(true);
  });

  it("refuses a document carrying a disposal, naming the line", () => {
    // The failure this replaces was silent: a mixed part + asset invoice pushed
    // BOTH lines against the sales-revenue account, so the provider GL showed
    // 5,100 of sales revenue and nothing as a disposal gain.
    try {
      assertNoAssetDisposalComponents(
        document([partComponent, assetComponent])
      );
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as Error).message).toMatch(/fixed-asset disposal/i);
      const { failure } = error as {
        failure: {
          errorCode: string;
          warning?: boolean;
          metadata?: { lineIds?: string[] };
        };
      };
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.warning).toBe(true);
      expect(failure.metadata?.lineIds).toEqual(["line-1"]);
    }
  });

  it("passes a document with no disposal", () => {
    expect(() =>
      assertNoAssetDisposalComponents(document([partComponent]))
    ).not.toThrow();
  });
});

describe("document rounding residual distribution", () => {
  function uniformLines(count: number, unitPrice: number, taxPercent: number) {
    const lines = Array.from({ length: count }, (_, index) => ({
      id: `l${String(index).padStart(3, "0")}`,
      invoiceLineType: "Service",
      itemId: "item",
      itemCode: "SVC",
      description: "Work",
      quantity: 1,
      unitPrice,
      convertedUnitPrice: unitPrice,
      shippingCost: 0,
      addOnCost: 0,
      nonTaxableAddOnCost: 0,
      taxPercent,
      lineAmount: unitPrice
    }));
    const subtotal = round(count * unitPrice);
    const totalTax = round(subtotal * taxPercent);
    return {
      ...fixture(),
      currencyCode: "USD",
      exchangeRate: 1,
      headerShippingCost: 0,
      subtotal,
      totalTax,
      totalAmount: round(subtotal + totalTax),
      balance: round(subtotal + totalTax),
      lines
    };
  }

  // Each case below concentrated its whole residual on one component before
  // largest-remainder distribution, producing a line whose tax no percentage
  // could reproduce. QuickBooks refuses exactly that (invoice-tax.ts), and the
  // 30 x 0.10 case previously emitted a negative tax on positive revenue.
  it.each([
    [20, 1.99, 0.0825],
    [30, 0.1, 0.0625],
    [40, 0.07, 0.07],
    [15, 0.5, 0.13],
    [3, 1.2, 0.0625]
  ])("keeps every component of %i x %d @ %d within one minor unit of its own rate", (count, unitPrice, taxPercent) => {
    const document = build(
      uniformLines(count, unitPrice, taxPercent) as ReturnType<typeof fixture>
    );
    const net = round(
      document.components.reduce((sum, c) => sum + c.netAmount, 0),
      document.decimalPlaces
    );
    const tax = round(
      document.components.reduce((sum, c) => sum + c.taxAmount, 0),
      document.decimalPlaces
    );
    expect(net).toBe(
      round(document.totalAmount - document.totalTax, document.decimalPlaces)
    );
    expect(tax).toBe(document.totalTax);
    for (const component of document.components) {
      const implied = round(
        component.netAmount * component.taxPercent,
        document.decimalPlaces
      );
      // The exact envelope QuickBooks' `tax = net x percent` preflight uses
      // (invoice-tax.ts), so passing here means the push is accepted.
      expect(Math.abs(implied - component.taxAmount)).toBeLessThanOrEqual(
        1 / 10 ** document.decimalPlaces + EPSILON
      );
      // A negative tax on positive revenue is silently postable in Xero.
      if (component.taxAmount !== 0) {
        expect(Math.sign(component.taxAmount)).toBe(
          Math.sign(component.netAmount)
        );
      }
      expect(
        round(component.quantity * component.unitAmount, document.decimalPlaces)
      ).toBe(component.netAmount);
    }
  });

  // Mixed-sign invariant guard (CodeRabbit, #1599). The distributor could place
  // a residual unit on a component whose sign it then reversed — a negative tax
  // against positive revenue. That is pinned directly, red-to-green, by
  // "never reverses a part's sign" in shared/precision.test.ts. This case is the
  // integration guard: it does NOT by itself reproduce the flip (these numbers
  // yield a surplus, not the deficit the flip needs), it asserts the invariant
  // holds for a credit line sitting alongside a positive one.
  it("never emits a tax whose sign contradicts its own net", () => {
    const source = {
      ...fixture(),
      currencyCode: "USD",
      exchangeRate: 1,
      headerShippingCost: 0,
      lines: [{ credit: -0.4 }, { credit: -0.4 }, { credit: 0.0143 }].map(
        (row, index) => ({
          ...fixture().lines[0]!,
          id: `l${index}`,
          quantity: 1,
          unitPrice: row.credit,
          convertedUnitPrice: row.credit,
          shippingCost: 0,
          addOnCost: 0,
          nonTaxableAddOnCost: 0,
          taxPercent: 0.07
        })
      )
    };
    const subtotal = round(-0.4 - 0.4 + 0.0143);
    const totalTax = round(subtotal * 0.07);
    const document = build({
      ...source,
      subtotal,
      totalTax,
      totalAmount: round(subtotal + totalTax),
      balance: round(subtotal + totalTax)
    } as ReturnType<typeof fixture>);

    for (const component of document.components) {
      if (component.taxAmount !== 0 && component.netAmount !== 0) {
        expect(Math.sign(component.taxAmount)).toBe(
          Math.sign(component.netAmount)
        );
      }
    }
    expect(
      round(
        document.components.reduce((sum, c) => sum + c.taxAmount, 0),
        document.decimalPlaces
      )
    ).toBe(document.totalTax);
  });
});
