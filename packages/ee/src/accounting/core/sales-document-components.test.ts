import { EPSILON, round } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { QboSalesInvoiceSyncer } from "../providers/quickbooks-online/entities/invoice";
import { RilletSalesInvoiceSyncer } from "../providers/rillet/entities/invoice";
import { SalesInvoiceSyncer } from "../providers/xero/entities/invoice";
import { SalesInvoiceSchema } from "./models";
import { buildSalesDocumentComponents } from "./sales-document-components";
import { loadSalesInvoices } from "./sales-invoice-source";
import type { Accounting } from "./types";

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
    await expect(
      loadSalesInvoices(database as never, {
        companyId: "company",
        ids: ["invoice"]
      })
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
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
});
