// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { EPSILON, round } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { SalesInvoiceSchema } from "./models";
import {
  assertNoAssetDisposalComponents,
  buildSalesDocumentComponents,
  hasRevenueComponent,
  isRevenueComponent
} from "./sales-document-components";
import {
  requirePostedSalesAccountId,
  requirePostedShippingAccountId,
  resolveReplayedRevenueAccounts
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
  it.each([1, 3])(
    "keeps provider quantity × unit price equal to reconciled net for quantity %i",
    (quantity) => {
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
          round(
            component.quantity * component.unitAmount,
            document.decimalPlaces
          )
        ).toBe(component.netAmount);
      }
      expect(source.lines[0]!.convertedUnitPrice).toBe(80 / quantity);
    }
  );

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

  it.each([0, 3])(
    "honors %i-decimal document amounts and reconciles deterministic fractional residuals",
    (decimalPlaces) => {
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
    }
  );

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

  it("reconciles a discounted line against the view's net totals and sends the net unit price", () => {
    const source = fixture();
    // 4 × 25 base list, 20% off → 80 base merchandise (64 EUR at 0.8). The
    // add-ons and shipping are not discounted; tax is on the discounted base.
    // View: subtotal 80 + 20 + 3 + 10 = 113, tax 0.1 × (80 + 20 + 10) = 11,
    // total 113 + 11 + 5 header = 129.
    const document = buildSalesDocumentComponents({
      ...source,
      subtotal: 113,
      totalTax: 11,
      totalAmount: 129,
      balance: 129,
      lines: [
        {
          ...source.lines[0]!,
          quantity: 4,
          unitPrice: 25,
          convertedUnitPrice: 20,
          discountPercent: 0.2,
          lineAmount: 80
        }
      ]
    } as Accounting.SalesInvoice);
    expect(document).toMatchObject({
      subtotal: 94.4,
      totalTax: 8.8,
      totalAmount: 103.2
    });
    expect(document.components[0]).toMatchObject({
      kind: "Merchandise",
      quantity: 4,
      unitAmount: 16,
      netAmount: 64,
      taxAmount: 6.4
    });
    // Add-ons stay at full price.
    expect(
      document.components.find((c) => c.kind === "TaxableAddOn")
    ).toMatchObject({ netAmount: 16 });
  });

  it("refuses a discounted line when the view's subtotal is not net of the discount", () => {
    const source = fixture();
    expect(() =>
      buildSalesDocumentComponents({
        ...source,
        lines: [{ ...source.lines[0]!, discountPercent: 0.2 }]
      } as Accounting.SalesInvoice)
    ).toThrow(/subtotal does not reconcile/);
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

  it.each(["subtotal", "totalTax", "totalAmount"] as const)(
    "does not conceal an economic mismatch in authoritative %s",
    (field) => {
      const source = fixture();
      source[field] += 1;
      expect(() => build(source)).toThrow(/reconcil|total|tax|subtotal/i);
    }
  );

  it.each([Number.NaN, 0, -1, Number.POSITIVE_INFINITY])(
    "rejects invalid foreign-per-base rate %s",
    (rate) => {
      const source = fixture();
      source.exchangeRate = rate;
      expect(() => build(source)).toThrow(/rate|finite/i);
    }
  );

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

// The original revenue account a provider document replays, per role, from the
// invoice's posted journal lines. A defect belongs to ONE invoice: the loader
// is a batch, and a throw there parks every sibling invoice drained beside it.
describe("resolveReplayedRevenueAccounts", () => {
  const posting = (
    documentId: string,
    accountId: string,
    overrides: Partial<{
      description: string;
      accountClass: string;
      isGroup: boolean;
    }> = {}
  ) => ({
    documentId,
    accountId,
    description: "Sales Account",
    accountClass: "Revenue",
    isGroup: false,
    ...overrides
  });
  const shipping = (documentId: string, accountId: string) =>
    posting(documentId, accountId, { description: "Shipping Revenue" });
  const replay = (rows: ReturnType<typeof posting>[], invoiceId: string) => {
    const resolve = resolveReplayedRevenueAccounts(rows);
    return {
      sales: resolve("SalesRevenue", invoiceId),
      shipping: resolve("ShippingRevenue", invoiceId)
    };
  };
  const clean = (documentId: string) => [
    posting(documentId, "sales-4000"),
    shipping(documentId, "shipping-4100")
  ];

  it("extracts the merchandise and shipping accounts the original journal credited", () => {
    expect(replay(clean("a"), "a")).toEqual({
      sales: "sales-4000",
      shipping: "shipping-4100"
    });
  });

  it("keeps a different original shipping account per invoice in one batch", () => {
    const rows = [shipping("a", "shipping-a"), shipping("b", "shipping-b")];
    expect(replay(rows, "a").shipping).toBe("shipping-a");
    expect(replay(rows, "b").shipping).toBe("shipping-b");
  });

  it("answers null for an invoice with no revenue postings rather than today's default", () => {
    expect(replay(clean("a"), "b")).toEqual({ sales: null, shipping: null });
  });

  it.each(["VOID: Shipping Revenue", "Some revenue"])(
    "does not read a %s line as an original revenue posting",
    (description) => {
      expect(replay([posting("a", "other", { description })], "a")).toEqual({
        sales: null,
        shipping: null
      });
    }
  );

  // Carbon posts all merchandise revenue to one account and all shipping to
  // another, so two of either means the journal is not the shape replayed.
  it.each([
    [
      "merchandise",
      [posting("bad", "sales-4000"), posting("bad", "sales-4001")],
      { sales: null, shipping: null }
    ],
    [
      "shipping",
      [shipping("bad", "shipping-a"), shipping("bad", "shipping-b")],
      { sales: null, shipping: null }
    ],
    [
      "a group merchandise",
      [posting("bad", "sales-parent", { isGroup: true })],
      { sales: null, shipping: null }
    ],
    // Only the broken role is unresolved; an invoice with no shipping still syncs.
    [
      "a non-Revenue shipping",
      [
        posting("bad", "sales-4000"),
        posting("bad", "shipping-asset", {
          description: "Shipping Revenue",
          accountClass: "Asset"
        })
      ],
      { sales: "sales-4000", shipping: null }
    ],
    // Half-broken is still broken: picking the surviving account is a guess.
    [
      "a group posting beside a valid merchandise",
      [
        posting("bad", "sales-parent", { isGroup: true }),
        posting("bad", "sales-4000")
      ],
      { sales: null, shipping: null }
    ]
  ])(
    "leaves the role unresolved for %s posting without touching a sibling invoice",
    (_case, badRows, expected) => {
      const rows = [...clean("good"), ...badRows];
      expect(replay(rows, "bad")).toEqual(expected);
      expect(replay(rows, "good")).toEqual({
        sales: "sales-4000",
        shipping: "shipping-4100"
      });
    }
  );
});

describe("requirePosted*AccountId", () => {
  it.each([
    ["sales", "salesRevenueAccountId", requirePostedSalesAccountId],
    ["shipping", "shippingRevenueAccountId", requirePostedShippingAccountId]
  ] as const)("returns the replayed %s account", (_role, field, require) => {
    expect(require(fixture() as Accounting.SalesInvoice)).toBe(
      fixture()[field]
    );
  });

  it.each([
    ["sales", "salesRevenueAccountId", requirePostedSalesAccountId],
    ["shipping", "shippingRevenueAccountId", requirePostedShippingAccountId]
  ] as const)(
    "parks the one invoice whose %s account is unresolved as an UNMAPPED_ACCOUNTS warning",
    (_role, field, require) => {
      const invoice = { ...fixture(), id: "bad", [field]: null };
      expect(
        failureOf(() => require(invoice as Accounting.SalesInvoice))
      ).toEqual({
        errorCode: "UNMAPPED_ACCOUNTS",
        warning: true,
        invoiceId: "bad"
      });
    }
  );
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
  ])(
    "keeps every component of %i x %d @ %d within one minor unit of its own rate",
    (count, unitPrice, taxPercent) => {
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
          round(
            component.quantity * component.unitAmount,
            document.decimalPlaces
          )
        ).toBe(component.netAmount);
      }
    }
  );

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
