/**
 * The proving rule for Carbon Learn's challenge checkers.
 *
 * A checker that cannot fail is a checker that certifies nothing, so EVERY
 * checker here is proved four ways: it fails on an empty company naming its
 * FIRST requirement, it passes on a known-good sequence, its first failure
 * names the record the learner has to go fix, and it hands the scope it was
 * given to the reader untouched (a checker that widened `since` or dropped
 * `userId` would pass a learner on somebody else's work).
 *
 * The fake reader stands in for the database. That is the whole reason the
 * checkers take a `LearnReader` instead of a Supabase client.
 */

import { describe, expect, it } from "vitest";
import { getChallenge, learnTracks } from "../curriculum";
import { checkers, getChecker } from "./index.server";
import type {
  LearnAccountingPeriodRow,
  LearnCustomFieldRow,
  LearnEmployeeTypeRow,
  LearnInspectionRow,
  LearnInventoryCountRow,
  LearnInviteRow,
  LearnItemLedgerRow,
  LearnItemPlanningRow,
  LearnItemRow,
  LearnJobRow,
  LearnNonConformanceRow,
  LearnPaymentRow,
  LearnPurchaseInvoiceRow,
  LearnPurchaseOrderLineRow,
  LearnPurchaseOrderRow,
  LearnQuoteRow,
  LearnReader,
  LearnReceiptLineRow,
  LearnReceiptRow,
  LearnSalesInvoiceRow,
  LearnSalesOrderRow,
  LearnShipmentRow,
  LearnStockTransferRow,
  LearnSupplierQuoteRow,
  LearnSupplierRow,
  ReaderScope
} from "./reader.server";

const SCOPE: ReaderScope = {
  companyId: "company-1",
  userId: "user-1",
  since: "2026-09-01T00:00:00.000Z"
};

type FakeData = {
  items: LearnItemRow[];
  purchaseOrders: LearnPurchaseOrderRow[];
  purchaseOrderLines: LearnPurchaseOrderLineRow[];
  receipts: LearnReceiptRow[];
  receiptLines: LearnReceiptLineRow[];
  suppliers: LearnSupplierRow[];
  supplierQuotes: LearnSupplierQuoteRow[];
  supplierQuoteLineCounts: Record<string, number>;
  purchaseInvoices: LearnPurchaseInvoiceRow[];
  payments: LearnPaymentRow[];
  accountingPeriods: LearnAccountingPeriodRow[];
  quotes: LearnQuoteRow[];
  quoteLineCounts: Record<string, number>;
  salesOrders: LearnSalesOrderRow[];
  shipments: LearnShipmentRow[];
  salesInvoices: LearnSalesInvoiceRow[];
  itemLedger: LearnItemLedgerRow[];
  stockTransfers: LearnStockTransferRow[];
  inventoryCounts: LearnInventoryCountRow[];
  inventoryCountLineCounts: Record<string, number>;
  jobs: LearnJobRow[];
  jobOperationCounts: Record<string, number>;
  jobMaterialCounts: Record<string, number>;
  itemPlanning: LearnItemPlanningRow[];
  purchaseOrderLinesForItems: Array<{
    purchaseOrderId: string;
    itemId: string;
  }>;
  nonConformances: LearnNonConformanceRow[];
  inspections: LearnInspectionRow[];
  employeeTypes: LearnEmployeeTypeRow[];
  employeeTypeGrants: Record<string, number>;
  customFields: LearnCustomFieldRow[];
  invites: LearnInviteRow[];
};

type BatchCall = { companyId: string; ids: string[] };

function makeFakeReader(overrides: Partial<FakeData> = {}) {
  const data: FakeData = {
    items: [],
    purchaseOrders: [],
    purchaseOrderLines: [],
    receipts: [],
    receiptLines: [],
    suppliers: [],
    supplierQuotes: [],
    supplierQuoteLineCounts: {},
    purchaseInvoices: [],
    payments: [],
    accountingPeriods: [],
    quotes: [],
    quoteLineCounts: {},
    salesOrders: [],
    shipments: [],
    salesInvoices: [],
    itemLedger: [],
    stockTransfers: [],
    inventoryCounts: [],
    inventoryCountLineCounts: {},
    jobs: [],
    jobOperationCounts: {},
    jobMaterialCounts: {},
    itemPlanning: [],
    purchaseOrderLinesForItems: [],
    nonConformances: [],
    inspections: [],
    employeeTypes: [],
    employeeTypeGrants: {},
    customFields: [],
    invites: [],
    ...overrides
  };

  const scopes: ReaderScope[] = [];
  const batched = {
    purchaseOrderLines: [] as BatchCall[],
    receiptLines: [] as BatchCall[],
    supplierQuoteLineCount: [] as BatchCall[],
    quoteLineCount: [] as BatchCall[],
    inventoryCountLineCount: [] as BatchCall[],
    jobOperationCount: [] as BatchCall[],
    jobMaterialCount: [] as BatchCall[]
  };

  /** Every count-by-parent reader shares this shape. */
  const pick = (source: Record<string, number>, ids: string[]) => {
    const counts: Record<string, number> = {};
    for (const id of ids) {
      const count = source[id];
      if (count) counts[id] = count;
    }
    return counts;
  };

  const reader: LearnReader = {
    async itemsCreatedBy(scope) {
      scopes.push(scope);
      return data.items;
    },
    async purchaseOrdersCreatedBy(scope) {
      scopes.push(scope);
      return data.purchaseOrders;
    },
    async purchaseOrderLines(companyId, ids) {
      batched.purchaseOrderLines.push({ companyId, ids });
      return data.purchaseOrderLines.filter((line) =>
        ids.includes(line.purchaseOrderId)
      );
    },
    async receiptsCreatedBy(scope) {
      scopes.push(scope);
      return data.receipts;
    },
    async receiptLines(companyId, ids) {
      batched.receiptLines.push({ companyId, ids });
      return data.receiptLines.filter((line) => ids.includes(line.receiptId));
    },
    async suppliersCreatedSince(scope) {
      scopes.push(scope);
      return data.suppliers;
    },
    async supplierQuotesCreatedBy(scope) {
      scopes.push(scope);
      return data.supplierQuotes;
    },
    async supplierQuoteLineCount(companyId, ids) {
      batched.supplierQuoteLineCount.push({ companyId, ids });
      return pick(data.supplierQuoteLineCounts, ids);
    },

    async purchaseInvoicesCreatedBy(scope) {
      scopes.push(scope);
      return data.purchaseInvoices;
    },
    async paymentsCreatedBy(scope) {
      scopes.push(scope);
      return data.payments;
    },
    async accountingPeriodsClosedBy(scope) {
      scopes.push(scope);
      return data.accountingPeriods;
    },

    async quotesCreatedBy(scope) {
      scopes.push(scope);
      return data.quotes;
    },
    async quoteLineCount(companyId, ids) {
      batched.quoteLineCount.push({ companyId, ids });
      return pick(data.quoteLineCounts, ids);
    },
    async salesOrdersCreatedBy(scope) {
      scopes.push(scope);
      return data.salesOrders;
    },
    async shipmentsCreatedBy(scope) {
      scopes.push(scope);
      return data.shipments;
    },
    async salesInvoicesCreatedBy(scope) {
      scopes.push(scope);
      return data.salesInvoices;
    },

    async itemLedgerEntriesCreatedBy(scope) {
      scopes.push(scope);
      return data.itemLedger;
    },
    async stockTransfersCreatedBy(scope) {
      scopes.push(scope);
      return data.stockTransfers;
    },
    async inventoryCountsCreatedBy(scope) {
      scopes.push(scope);
      return data.inventoryCounts;
    },
    async inventoryCountLineCount(companyId, ids) {
      batched.inventoryCountLineCount.push({ companyId, ids });
      return pick(data.inventoryCountLineCounts, ids);
    },

    async jobsCreatedBy(scope) {
      scopes.push(scope);
      return data.jobs;
    },
    async jobOperationCount(companyId, ids) {
      batched.jobOperationCount.push({ companyId, ids });
      return pick(data.jobOperationCounts, ids);
    },
    async jobMaterialCount(companyId, ids) {
      batched.jobMaterialCount.push({ companyId, ids });
      return pick(data.jobMaterialCounts, ids);
    },

    async itemPlanningUpdatedBy(scope) {
      scopes.push(scope);
      return data.itemPlanning;
    },
    async purchaseOrderLinesForItems(scope, itemIds) {
      scopes.push(scope);
      return data.purchaseOrderLinesForItems.filter((line) =>
        itemIds.includes(line.itemId)
      );
    },

    async nonConformancesCreatedBy(scope) {
      scopes.push(scope);
      return data.nonConformances;
    },
    async inspectionsCreatedBy(scope) {
      scopes.push(scope);
      return data.inspections;
    },

    async employeeTypesCreatedSince(scope) {
      scopes.push(scope);
      return data.employeeTypes;
    },
    async employeeTypeGrantCount(ids) {
      return pick(data.employeeTypeGrants, ids);
    },
    async customFieldsCreatedBy(scope) {
      scopes.push(scope);
      return data.customFields;
    },
    async invitesCreatedBy(scope) {
      scopes.push(scope);
      return data.invites;
    }
  };

  return { reader, scopes, batched };
}

function expectScopeUntouched(scopes: ReaderScope[]) {
  expect(scopes.length).toBeGreaterThan(0);
  for (const scope of scopes) {
    expect(scope.userId).toBe(SCOPE.userId);
    expect(scope.since).toBe(SCOPE.since);
    expect(scope.companyId).toBe(SCOPE.companyId);
  }
}

/** Narrowing helper — a failing result is the only one with a requirement. */
function failureOf(
  result: Awaited<ReturnType<NonNullable<ReturnType<typeof getChecker>>>>
) {
  if (result.passed)
    throw new Error("expected the checker to fail, but it passed");
  return result;
}

function evidenceOf(
  result: Awaited<ReturnType<NonNullable<ReturnType<typeof getChecker>>>>
) {
  if (!result.passed) {
    throw new Error(
      `expected a pass, got ${result.failedRequirement}: ${result.message}`
    );
  }
  return result.evidence;
}

const checkerFor = (slug: string) => {
  const checker = getChecker(slug);
  if (!checker) throw new Error(`no checker registered for ${slug}`);
  return checker;
};

// ---------------------------------------------------------------- fixtures

const PART: LearnItemRow = {
  id: "item-uuid-1",
  readableId: "P000123",
  name: "Mounting bracket",
  type: "Part"
};

const MATERIAL: LearnItemRow = {
  id: "item-uuid-2",
  readableId: "R000009",
  name: "Aluminium sheet",
  type: "Material"
};

const UNNAMED_PART: LearnItemRow = {
  id: "item-uuid-3",
  readableId: "P000999",
  name: "   ",
  type: "Part"
};

const RELEASED_PO: LearnPurchaseOrderRow = {
  id: "po-uuid-1",
  purchaseOrderId: "PO000123",
  status: "To Receive and Invoice",
  supplierId: "supplier-uuid-1"
};

const DRAFT_PO: LearnPurchaseOrderRow = {
  id: "po-uuid-2",
  purchaseOrderId: "PO000124",
  status: "Draft",
  supplierId: "supplier-uuid-1"
};

const orderedLines = (purchaseOrderId: string, count: number) =>
  Array.from({ length: count }, () => ({
    purchaseOrderId,
    purchaseQuantity: 100,
    purchaseOrderLineType: "Part"
  }));

const POSTED_RECEIPT: LearnReceiptRow = {
  id: "receipt-uuid-1",
  receiptId: "RE000045",
  status: "Posted",
  sourceDocument: "Purchase Order",
  sourceDocumentId: RELEASED_PO.id
};

const DRAFT_RECEIPT: LearnReceiptRow = {
  id: "receipt-uuid-2",
  receiptId: "RE000046",
  status: "Draft",
  sourceDocument: "Purchase Order",
  sourceDocumentId: RELEASED_PO.id
};

const SUPPLIER: LearnSupplierRow = {
  id: "supplier-uuid-1",
  name: "Brackets Ltd",
  createdBy: "user-1"
};

const ACTIVE_QUOTE: LearnSupplierQuoteRow = {
  id: "quote-uuid-1",
  status: "Active",
  supplierId: SUPPLIER.id
};

const RECEIVED_LINE: LearnReceiptLineRow = {
  receiptId: POSTED_RECEIPT.id,
  receivedQuantity: 500
};

// ------------------------------------------------ fundamentals-create-item

describe("fundamentals-create-item", () => {
  const check = checkerFor("fundamentals-create-item");

  it("fails on an empty company, naming its first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("item-exists");
  });

  it("names the item that is the wrong type", async () => {
    const { reader } = makeFakeReader({ items: [MATERIAL] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("item-is-part");
    expect(failure.message).toContain("R000009");
    expect(failure.message).toContain("Material");
  });

  it("does not accept a Part with a blank name", async () => {
    const { reader } = makeFakeReader({ items: [UNNAMED_PART] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("item-named");
    expect(failure.message).toContain("P000999");
  });

  it("passes on a named Part and evidences it", async () => {
    const { reader } = makeFakeReader({ items: [MATERIAL, PART] });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      itemId: "item-uuid-1",
      readableId: "P000123"
    });
  });

  it("hands the scope to the reader unchanged", async () => {
    const { reader, scopes } = makeFakeReader({ items: [PART] });
    await check({ scope: SCOPE, reader });
    expectScopeUntouched(scopes);
  });
});

// ------------------------------------------ purchasing-create-release-po

describe("purchasing-create-release-po", () => {
  const check = checkerFor("purchasing-create-release-po");

  it("fails on an empty company, naming its first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("po-exists");
  });

  it("does not count a Comment line or a zero-quantity line", async () => {
    const { reader } = makeFakeReader({
      purchaseOrders: [RELEASED_PO],
      purchaseOrderLines: [
        ...orderedLines(RELEASED_PO.id, 1),
        {
          purchaseOrderId: RELEASED_PO.id,
          purchaseQuantity: 5,
          purchaseOrderLineType: "Comment"
        },
        {
          purchaseOrderId: RELEASED_PO.id,
          purchaseQuantity: 0,
          purchaseOrderLineType: "Part"
        },
        {
          purchaseOrderId: RELEASED_PO.id,
          purchaseQuantity: null,
          purchaseOrderLineType: "Part"
        }
      ]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("po-two-lines");
    expect(failure.message).toContain("PO000123");
  });

  it("names the order that is still Draft", async () => {
    const { reader } = makeFakeReader({
      purchaseOrders: [DRAFT_PO],
      purchaseOrderLines: orderedLines(DRAFT_PO.id, 2)
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("po-released");
    expect(failure.message).toContain("PO000124");
    expect(failure.message).toContain("Draft");
  });

  it("passes on a released two-line order, batching the line read", async () => {
    const { reader, batched } = makeFakeReader({
      purchaseOrders: [DRAFT_PO, RELEASED_PO],
      purchaseOrderLines: [
        ...orderedLines(DRAFT_PO.id, 2),
        ...orderedLines(RELEASED_PO.id, 2)
      ]
    });

    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      purchaseOrderId: "po-uuid-1",
      readableId: "PO000123"
    });

    // One read for every order's lines — not one read per order.
    expect(batched.purchaseOrderLines).toHaveLength(1);
    expect(batched.purchaseOrderLines[0].ids).toEqual([
      "po-uuid-2",
      "po-uuid-1"
    ]);
    expect(batched.purchaseOrderLines[0].companyId).toBe(SCOPE.companyId);
  });

  it("accepts every released status, not one exact value", async () => {
    for (const status of [
      "To Receive",
      "To Invoice",
      "To Receive and Invoice",
      "Completed"
    ]) {
      const order = { ...RELEASED_PO, status };
      const { reader } = makeFakeReader({
        purchaseOrders: [order],
        purchaseOrderLines: orderedLines(order.id, 2)
      });
      const result = await check({ scope: SCOPE, reader });
      expect(result.passed, `${status} should count as released`).toBe(true);
    }
  });

  it("hands the scope to the reader unchanged", async () => {
    const { reader, scopes } = makeFakeReader({
      purchaseOrders: [RELEASED_PO],
      purchaseOrderLines: orderedLines(RELEASED_PO.id, 2)
    });
    await check({ scope: SCOPE, reader });
    expectScopeUntouched(scopes);
  });
});

// ------------------------------------------------- purchasing-receive-po

describe("purchasing-receive-po", () => {
  const check = checkerFor("purchasing-receive-po");

  it("fails on an empty company, naming its first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("po-exists-released");
  });

  it("names the order that has not been released", async () => {
    const { reader } = makeFakeReader({ purchaseOrders: [DRAFT_PO] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("po-exists-released");
    expect(failure.message).toContain("PO000124");
  });

  it("ignores a receipt that is not against one of the learner's orders", async () => {
    const { reader } = makeFakeReader({
      purchaseOrders: [RELEASED_PO],
      receipts: [
        { ...POSTED_RECEIPT, sourceDocumentId: "someone-elses-po" },
        {
          ...POSTED_RECEIPT,
          id: "receipt-uuid-9",
          sourceDocument: "Purchase Invoice"
        }
      ]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("receipt-exists");
    expect(failure.message).toContain("PO000123");
  });

  it("names the receipt that is not Posted", async () => {
    const { reader } = makeFakeReader({
      purchaseOrders: [RELEASED_PO],
      receipts: [DRAFT_RECEIPT]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("receipt-posted");
    expect(failure.message).toContain("RE000046");
  });

  it("rejects a posted receipt with nothing received", async () => {
    const { reader } = makeFakeReader({
      purchaseOrders: [RELEASED_PO],
      receipts: [POSTED_RECEIPT],
      receiptLines: [{ receiptId: POSTED_RECEIPT.id, receivedQuantity: 0 }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("receipt-has-quantity");
    expect(failure.message).toContain("RE000045");
  });

  it("passes on a posted receipt with a quantity", async () => {
    const { reader, batched } = makeFakeReader({
      purchaseOrders: [RELEASED_PO],
      receipts: [DRAFT_RECEIPT, POSTED_RECEIPT],
      receiptLines: [RECEIVED_LINE]
    });

    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      purchaseOrderId: "po-uuid-1",
      receiptId: "receipt-uuid-1",
      readableId: "RE000045"
    });
    expect(batched.receiptLines).toHaveLength(1);
  });

  it("hands the scope to the reader unchanged", async () => {
    const { reader, scopes } = makeFakeReader({
      purchaseOrders: [RELEASED_PO],
      receipts: [POSTED_RECEIPT],
      receiptLines: [RECEIVED_LINE]
    });
    await check({ scope: SCOPE, reader });
    expectScopeUntouched(scopes);
  });
});

// --------------------------------- purchasing-capstone-source-brackets

describe("purchasing-capstone-source-brackets", () => {
  const check = checkerFor("purchasing-capstone-source-brackets");

  const passingCompany = (): Partial<FakeData> => ({
    suppliers: [SUPPLIER],
    supplierQuotes: [ACTIVE_QUOTE],
    supplierQuoteLineCounts: { [ACTIVE_QUOTE.id]: 2 },
    purchaseOrders: [RELEASED_PO],
    receipts: [POSTED_RECEIPT]
  });

  it("fails on an empty company, naming its first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("supplier-created");
  });

  it("does not accept an Active quote with no lines", async () => {
    const { reader } = makeFakeReader({
      ...passingCompany(),
      supplierQuoteLineCounts: {}
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("quote-active");
    expect(failure.message).toContain("Brackets Ltd");
  });

  it("names the order to the new supplier that is still Draft", async () => {
    const { reader } = makeFakeReader({
      ...passingCompany(),
      purchaseOrders: [DRAFT_PO],
      receipts: []
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("po-released-for-supplier");
    expect(failure.message).toContain("PO000124");
    expect(failure.message).toContain("Brackets Ltd");
  });

  it("names the receipt against that order that is not Posted", async () => {
    const { reader } = makeFakeReader({
      ...passingCompany(),
      receipts: [DRAFT_RECEIPT]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("receipt-posted");
    expect(failure.message).toContain("RE000046");
    expect(failure.message).toContain("PO000123");
  });

  it("refuses a chain that spans two different suppliers", async () => {
    // Quote from the new supplier, order to somebody else: not a chain.
    const { reader } = makeFakeReader({
      ...passingCompany(),
      purchaseOrders: [{ ...RELEASED_PO, supplierId: "supplier-uuid-other" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("po-released-for-supplier");
  });

  it("passes on the whole chain and evidences all four ids", async () => {
    const { reader } = makeFakeReader(passingCompany());
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      supplierId: "supplier-uuid-1",
      supplierQuoteId: "quote-uuid-1",
      purchaseOrderId: "po-uuid-1",
      receiptId: "receipt-uuid-1"
    });
  });

  it("hands the scope to the reader unchanged", async () => {
    const { reader, scopes } = makeFakeReader(passingCompany());
    await check({ scope: SCOPE, reader });
    expectScopeUntouched(scopes);
  });
});

// ---------------------------------------------------------- accounting

describe("accounting-post-purchase-invoice", () => {
  const check = checkerFor("accounting-post-purchase-invoice");
  const posted: LearnPurchaseInvoiceRow[] = [
    { id: "pinv-1", invoiceId: "PINV000045", status: "Open" }
  ];

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("invoice-exists");
  });

  it("names the unposted bill rather than saying nothing exists", async () => {
    const { reader } = makeFakeReader({
      purchaseInvoices: [
        { id: "pinv-2", invoiceId: "PINV000046", status: "Draft" }
      ]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("invoice-posted");
    expect(failure.message).toContain("PINV000046");
  });

  it("accepts a bill that has since been paid", async () => {
    const { reader } = makeFakeReader({
      purchaseInvoices: [{ id: "pinv-3", invoiceId: "PINV1", status: "Paid" }]
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).status).toBe(
      "Paid"
    );
  });

  it("passes on a posted bill and hands the scope over unchanged", async () => {
    const { reader, scopes } = makeFakeReader({ purchaseInvoices: posted });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      purchaseInvoiceId: "pinv-1",
      invoiceId: "PINV000045",
      status: "Open"
    });
    expectScopeUntouched(scopes);
  });
});

describe("accounting-record-payment", () => {
  const check = checkerFor("accounting-record-payment");
  const disbursement: LearnPaymentRow = {
    id: "pay-1",
    paymentId: "PAY000012",
    paymentType: "Disbursement",
    status: "Posted",
    supplierId: "supplier-uuid-1"
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("payment-exists");
  });

  it("refuses a customer receipt — that is money coming in", async () => {
    const { reader } = makeFakeReader({
      payments: [{ ...disbursement, paymentType: "Receipt", supplierId: null }]
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("payment-supplier");
  });

  it("refuses a supplier payment still in Draft", async () => {
    const { reader } = makeFakeReader({
      payments: [{ ...disbursement, status: "Draft" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("payment-posted");
    expect(failure.message).toContain("PAY000012");
  });

  it("passes on a posted disbursement", async () => {
    const { reader, scopes } = makeFakeReader({ payments: [disbursement] });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).paymentId).toBe(
      "pay-1"
    );
    expectScopeUntouched(scopes);
  });
});

describe("accounting-close-a-period", () => {
  const check = checkerFor("accounting-close-a-period");
  const closed: LearnAccountingPeriodRow = {
    id: "period-1",
    fiscalYear: 2026,
    periodNumber: 8,
    closeStatus: "Closed"
  };

  it("fails on an empty company, naming its only requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("period-closed");
  });

  it("refuses a Locked period and says locking is not closing", async () => {
    const { reader } = makeFakeReader({
      accountingPeriods: [{ ...closed, closeStatus: "Locked" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("period-closed");
    expect(failure.message).toContain("Locked");
  });

  it("passes on a closed period", async () => {
    const { reader, scopes } = makeFakeReader({ accountingPeriods: [closed] });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      accountingPeriodId: "period-1",
      fiscalYear: 2026,
      periodNumber: 8
    });
    expectScopeUntouched(scopes);
  });
});

// --------------------------------------------------------------- sales

const QUOTE: LearnQuoteRow = {
  id: "quote-uuid-9",
  quoteId: "QUO000007",
  status: "Sent",
  opportunityId: "opp-1"
};

const ORDER_FROM_QUOTE: LearnSalesOrderRow = {
  id: "so-uuid-1",
  salesOrderId: "SO000031",
  status: "Confirmed",
  customerId: "customer-1",
  opportunityId: "opp-1"
};

describe("sales-create-quote", () => {
  const check = checkerFor("sales-create-quote");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("quote-exists");
  });

  it("names the empty quote", async () => {
    const { reader } = makeFakeReader({ quotes: [QUOTE] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("quote-has-line");
    expect(failure.message).toContain("QUO000007");
  });

  it("passes on a quote with a line, batching the line read", async () => {
    const { reader, scopes, batched } = makeFakeReader({
      quotes: [QUOTE],
      quoteLineCounts: { [QUOTE.id]: 3 }
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).quoteId).toBe(
      QUOTE.id
    );
    expect(batched.quoteLineCount).toHaveLength(1);
    expectScopeUntouched(scopes);
  });
});

describe("sales-convert-to-order", () => {
  const check = checkerFor("sales-convert-to-order");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("quote-exists");
  });

  it("refuses a fresh order that shares no opportunity with the quote", async () => {
    const { reader } = makeFakeReader({
      quotes: [QUOTE],
      salesOrders: [{ ...ORDER_FROM_QUOTE, opportunityId: "opp-other" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("order-from-quote");
    expect(failure.message).toContain("QUO000007");
  });

  it("refuses a converted order still sitting in Draft", async () => {
    const { reader } = makeFakeReader({
      quotes: [QUOTE],
      salesOrders: [{ ...ORDER_FROM_QUOTE, status: "Draft" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("order-confirmed");
    expect(failure.message).toContain("SO000031");
  });

  it("passes on a confirmed order raised from the quote", async () => {
    const { reader, scopes } = makeFakeReader({
      quotes: [QUOTE],
      salesOrders: [ORDER_FROM_QUOTE]
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      quoteId: QUOTE.id,
      salesOrderId: ORDER_FROM_QUOTE.id,
      readableId: "SO000031"
    });
    expectScopeUntouched(scopes);
  });
});

describe("sales-quote-to-invoice", () => {
  const check = checkerFor("sales-quote-to-invoice");
  const shipment: LearnShipmentRow = {
    id: "ship-1",
    shipmentId: "SH000004",
    status: "Posted",
    customerId: "customer-1"
  };
  const invoice: LearnSalesInvoiceRow = {
    id: "sinv-1",
    invoiceId: "SINV000010",
    status: "Submitted",
    customerId: "customer-1"
  };
  const wholeChain = () => ({
    quotes: [QUOTE],
    salesOrders: [ORDER_FROM_QUOTE],
    shipments: [shipment],
    salesInvoices: [invoice]
  });

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("quote-exists");
  });

  it("refuses an unposted shipment", async () => {
    const { reader } = makeFakeReader({
      ...wholeChain(),
      shipments: [{ ...shipment, status: "Draft" }]
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("shipment-posted");
  });

  it("refuses a shipment to a different customer", async () => {
    const { reader } = makeFakeReader({
      ...wholeChain(),
      shipments: [{ ...shipment, customerId: "customer-other" }]
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("shipment-posted");
  });

  it("refuses a shipped order that was never billed", async () => {
    const { reader } = makeFakeReader({ ...wholeChain(), salesInvoices: [] });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("invoice-posted");
  });

  it("passes on the whole chain and evidences all four ids", async () => {
    const { reader, scopes } = makeFakeReader(wholeChain());
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      quoteId: QUOTE.id,
      salesOrderId: ORDER_FROM_QUOTE.id,
      shipmentId: "ship-1",
      salesInvoiceId: "sinv-1",
      invoiceReadableId: "SINV000010"
    });
    expectScopeUntouched(scopes);
  });
});

// ----------------------------------------------------------- inventory

describe("inventory-adjust-quantity", () => {
  const check = checkerFor("inventory-adjust-quantity");
  const adjustment: LearnItemLedgerRow = {
    id: "ledger-1",
    entryType: "Positive Adjmt.",
    quantity: 12,
    itemId: PART.id
  };

  it("fails on an empty company, naming its only requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("adjustment-posted");
  });

  it("refuses a receipt entry and names what it found instead", async () => {
    const { reader } = makeFakeReader({
      itemLedger: [{ ...adjustment, entryType: "Purchase" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("adjustment-posted");
    expect(failure.message).toContain("Purchase");
  });

  it("accepts a negative adjustment too", async () => {
    const { reader } = makeFakeReader({
      itemLedger: [{ ...adjustment, entryType: "Negative Adjmt." }]
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).entryType).toBe(
      "Negative Adjmt."
    );
  });

  it("passes on a posted adjustment", async () => {
    const { reader, scopes } = makeFakeReader({ itemLedger: [adjustment] });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).itemLedgerId).toBe(
      "ledger-1"
    );
    expectScopeUntouched(scopes);
  });
});

describe("inventory-transfer-stock", () => {
  const check = checkerFor("inventory-transfer-stock");
  const transfer: LearnStockTransferRow = {
    id: "xfer-1",
    stockTransferId: "ST000003",
    status: "Released"
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("transfer-exists");
  });

  it("names the draft transfer", async () => {
    const { reader } = makeFakeReader({
      stockTransfers: [{ ...transfer, status: "Draft" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("transfer-released");
    expect(failure.message).toContain("ST000003");
  });

  it("passes on a released transfer", async () => {
    const { reader, scopes } = makeFakeReader({ stockTransfers: [transfer] });
    expect(
      evidenceOf(await check({ scope: SCOPE, reader })).stockTransferId
    ).toBe("xfer-1");
    expectScopeUntouched(scopes);
  });
});

describe("inventory-count-and-post", () => {
  const check = checkerFor("inventory-count-and-post");
  const count: LearnInventoryCountRow = {
    id: "count-1",
    inventoryCountId: "IC000002",
    status: "Posted"
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("count-exists");
  });

  it("refuses a count with nothing on it", async () => {
    const { reader } = makeFakeReader({ inventoryCounts: [count] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("count-has-lines");
    expect(failure.message).toContain("IC000002");
  });

  it("refuses a counted-but-unposted count", async () => {
    const { reader } = makeFakeReader({
      inventoryCounts: [{ ...count, status: "Pending" }],
      inventoryCountLineCounts: { "count-1": 4 }
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("count-posted");
  });

  it("passes on a posted count, batching the line read", async () => {
    const { reader, scopes, batched } = makeFakeReader({
      inventoryCounts: [count],
      inventoryCountLineCounts: { "count-1": 4 }
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      inventoryCountId: "count-1",
      readableId: "IC000002",
      lines: 4
    });
    expect(batched.inventoryCountLineCount).toHaveLength(1);
    expectScopeUntouched(scopes);
  });
});

// ---------------------------------------------------------- production

const JOB: LearnJobRow = {
  id: "job-uuid-1",
  jobId: "JOB000014",
  status: "Ready",
  quantityComplete: 0
};

describe("production-create-job", () => {
  const check = checkerFor("production-create-job");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("job-exists");
  });

  it("names a job whose item had no routing", async () => {
    const { reader } = makeFakeReader({ jobs: [JOB] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("job-has-operation");
    expect(failure.message).toContain("JOB000014");
  });

  it("refuses a routed job with no bill of materials", async () => {
    const { reader } = makeFakeReader({
      jobs: [JOB],
      jobOperationCounts: { [JOB.id]: 3 }
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("job-has-material");
  });

  it("passes on a job with a method, batching both child reads", async () => {
    const { reader, scopes, batched } = makeFakeReader({
      jobs: [JOB],
      jobOperationCounts: { [JOB.id]: 3 },
      jobMaterialCounts: { [JOB.id]: 5 }
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      jobId: JOB.id,
      readableId: "JOB000014",
      operations: 3,
      materials: 5
    });
    expect(batched.jobOperationCount).toHaveLength(1);
    expect(batched.jobMaterialCount).toHaveLength(1);
    expectScopeUntouched(scopes);
  });
});

describe("production-release-job", () => {
  const check = checkerFor("production-release-job");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("job-exists");
  });

  it("names the draft job", async () => {
    const { reader } = makeFakeReader({ jobs: [{ ...JOB, status: "Draft" }] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("job-released");
    expect(failure.message).toContain("JOB000014");
  });

  it("accepts a job that has already moved past Ready", async () => {
    const { reader } = makeFakeReader({
      jobs: [{ ...JOB, status: "In Progress" }]
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).status).toBe(
      "In Progress"
    );
  });

  it("passes on a released job", async () => {
    const { reader, scopes } = makeFakeReader({ jobs: [JOB] });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).jobId).toBe(
      JOB.id
    );
    expectScopeUntouched(scopes);
  });
});

describe("production-complete-job", () => {
  const check = checkerFor("production-complete-job");
  const finished: LearnJobRow = {
    ...JOB,
    status: "Completed",
    quantityComplete: 25
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("job-exists");
  });

  it("names production before status — a Completed job that made nothing", async () => {
    const { reader } = makeFakeReader({
      jobs: [{ ...finished, quantityComplete: 0 }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("job-produced");
    expect(failure.message).toContain("JOB000014");
  });

  it("refuses a job that produced parts but was never finished", async () => {
    const { reader } = makeFakeReader({
      jobs: [{ ...finished, status: "In Progress" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("job-completed");
    expect(failure.message).toContain("25");
  });

  it("passes on a completed job with output", async () => {
    const { reader, scopes } = makeFakeReader({ jobs: [finished] });
    expect(
      evidenceOf(await check({ scope: SCOPE, reader })).quantityComplete
    ).toBe(25);
    expectScopeUntouched(scopes);
  });
});

// ------------------------------------------------------------ planning

const PLANNED_ITEM: LearnItemPlanningRow = {
  itemId: PART.id,
  reorderingPolicy: "Fixed Reorder Quantity",
  reorderPoint: 50,
  reorderQuantity: 200,
  maximumInventoryQuantity: null,
  demandAccumulationPeriod: null
};

describe("planning-set-reorder-policy", () => {
  const check = checkerFor("planning-set-reorder-policy");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("policy-set");
  });

  it("refuses a part left on the manual default", async () => {
    const { reader } = makeFakeReader({
      itemPlanning: [{ ...PLANNED_ITEM, reorderingPolicy: "Manual Reorder" }]
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("policy-not-manual");
  });

  it("names the number the chosen policy is missing", async () => {
    const { reader } = makeFakeReader({
      itemPlanning: [{ ...PLANNED_ITEM, reorderQuantity: null }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("policy-has-numbers");
    expect(failure.message).toContain("a reorder quantity");
  });

  it("requires a maximum for the Maximum Quantity policy", async () => {
    const { reader } = makeFakeReader({
      itemPlanning: [{ ...PLANNED_ITEM, reorderingPolicy: "Maximum Quantity" }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.message).toContain("a maximum inventory quantity");
  });

  it("passes on a complete policy", async () => {
    const { reader, scopes } = makeFakeReader({ itemPlanning: [PLANNED_ITEM] });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      itemId: PART.id,
      reorderingPolicy: "Fixed Reorder Quantity"
    });
    expectScopeUntouched(scopes);
  });
});

describe("planning-run-mrp-and-review", () => {
  const check = checkerFor("planning-run-mrp-and-review");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("policy-set");
  });

  it("refuses a planned part nothing has been ordered for", async () => {
    const { reader } = makeFakeReader({ itemPlanning: [PLANNED_ITEM] });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("order-for-item");
  });

  it("ignores an order raised for a different part", async () => {
    const { reader } = makeFakeReader({
      itemPlanning: [PLANNED_ITEM],
      purchaseOrderLinesForItems: [
        { purchaseOrderId: "po-uuid-9", itemId: MATERIAL.id }
      ]
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("order-for-item");
  });

  it("passes once the planned part is on an order", async () => {
    const { reader, scopes } = makeFakeReader({
      itemPlanning: [PLANNED_ITEM],
      purchaseOrderLinesForItems: [
        { purchaseOrderId: "po-uuid-9", itemId: PART.id }
      ]
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      itemId: PART.id,
      purchaseOrderId: "po-uuid-9",
      reorderingPolicy: "Fixed Reorder Quantity"
    });
    expectScopeUntouched(scopes);
  });
});

// ------------------------------------------------------------- quality

const OPEN_NCR: LearnNonConformanceRow = {
  id: "ncr-1",
  nonConformanceId: "NCR000006",
  name: "Bore out of tolerance",
  status: "In Progress",
  closeDate: null
};

describe("quality-raise-issue", () => {
  const check = checkerFor("quality-raise-issue");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("issue-exists");
  });

  it("refuses a nameless non-conformance", async () => {
    const { reader } = makeFakeReader({
      nonConformances: [{ ...OPEN_NCR, name: "   " }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("issue-described");
    expect(failure.message).toContain("NCR000006");
  });

  it("passes on a described non-conformance", async () => {
    const { reader, scopes } = makeFakeReader({ nonConformances: [OPEN_NCR] });
    expect(
      evidenceOf(await check({ scope: SCOPE, reader })).nonConformanceId
    ).toBe("ncr-1");
    expectScopeUntouched(scopes);
  });
});

describe("quality-record-inspection", () => {
  const check = checkerFor("quality-record-inspection");
  const inspection: LearnInspectionRow = {
    id: "insp-1",
    inspectionId: "INS000021",
    status: "Pass"
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("inspection-exists");
  });

  it("refuses an inspection with no verdict", async () => {
    const { reader } = makeFakeReader({
      inspections: [{ ...inspection, status: null }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("inspection-resulted");
    expect(failure.message).toContain("INS000021");
  });

  it("accepts a Fail — a recorded failure is still a recorded result", async () => {
    const { reader } = makeFakeReader({
      inspections: [{ ...inspection, status: "Fail" }]
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).status).toBe(
      "Fail"
    );
  });

  it("passes on a resulted inspection", async () => {
    const { reader, scopes } = makeFakeReader({ inspections: [inspection] });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).inspectionId).toBe(
      "insp-1"
    );
    expectScopeUntouched(scopes);
  });
});

describe("quality-close-an-issue", () => {
  const check = checkerFor("quality-close-an-issue");
  const closed: LearnNonConformanceRow = {
    ...OPEN_NCR,
    status: "Closed",
    closeDate: "2026-09-04"
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("issue-exists");
  });

  it("names the still-open non-conformance", async () => {
    const { reader } = makeFakeReader({ nonConformances: [OPEN_NCR] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("issue-closed");
    expect(failure.message).toContain("In Progress");
  });

  it("refuses a Closed non-conformance carrying no close date", async () => {
    const { reader } = makeFakeReader({
      nonConformances: [{ ...closed, closeDate: null }]
    });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("issue-close-dated");
  });

  it("passes on a properly closed non-conformance", async () => {
    const { reader, scopes } = makeFakeReader({ nonConformances: [closed] });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).closeDate).toBe(
      "2026-09-04"
    );
    expectScopeUntouched(scopes);
  });
});

// --------------------------------------------------------------- admin

const EMPLOYEE_TYPE: LearnEmployeeTypeRow = {
  id: "etype-1",
  name: "Shift Supervisor"
};

describe("admin-create-employee-type", () => {
  const check = checkerFor("admin-create-employee-type");

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("type-exists");
  });

  it("refuses a type that grants nothing", async () => {
    const { reader } = makeFakeReader({ employeeTypes: [EMPLOYEE_TYPE] });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("type-has-permission");
    expect(failure.message).toContain("Shift Supervisor");
  });

  it("passes on a permissioned type", async () => {
    const { reader, scopes } = makeFakeReader({
      employeeTypes: [EMPLOYEE_TYPE],
      employeeTypeGrants: { "etype-1": 2 }
    });
    expect(evidenceOf(await check({ scope: SCOPE, reader }))).toEqual({
      employeeTypeId: "etype-1",
      name: "Shift Supervisor",
      modulesGranted: 2
    });
    expectScopeUntouched(scopes);
  });
});

describe("admin-add-custom-field", () => {
  const check = checkerFor("admin-add-custom-field");
  const field: LearnCustomFieldRow = {
    id: "cf-1",
    name: "Heat number",
    table: "item",
    active: true
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("field-exists");
  });

  it("refuses an inactive field", async () => {
    const { reader } = makeFakeReader({
      customFields: [{ ...field, active: false }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("field-active");
    expect(failure.message).toContain("Heat number");
  });

  it("passes on an active field", async () => {
    const { reader, scopes } = makeFakeReader({ customFields: [field] });
    expect(evidenceOf(await check({ scope: SCOPE, reader })).table).toBe(
      "item"
    );
    expectScopeUntouched(scopes);
  });
});

describe("admin-invite-and-permission", () => {
  const check = checkerFor("admin-invite-and-permission");
  const invite: LearnInviteRow = {
    id: "invite-1",
    email: "new.starter@example.com",
    role: "employee",
    permissionCount: 4
  };

  it("fails on an empty company, naming the first requirement", async () => {
    const { reader } = makeFakeReader();
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("type-exists");
  });

  it("refuses when nobody has been invited", async () => {
    const { reader } = makeFakeReader({ employeeTypes: [EMPLOYEE_TYPE] });
    expect(
      failureOf(await check({ scope: SCOPE, reader })).failedRequirement
    ).toBe("invite-exists");
  });

  it("refuses an invitation that grants nothing", async () => {
    const { reader } = makeFakeReader({
      employeeTypes: [EMPLOYEE_TYPE],
      invites: [{ ...invite, permissionCount: 0 }]
    });
    const failure = failureOf(await check({ scope: SCOPE, reader }));
    expect(failure.failedRequirement).toBe("invite-has-permissions");
    expect(failure.message).toContain("new.starter@example.com");
  });

  it("passes on a permissioned invitation", async () => {
    const { reader, scopes } = makeFakeReader({
      employeeTypes: [EMPLOYEE_TYPE],
      invites: [invite]
    });
    expect(
      evidenceOf(await check({ scope: SCOPE, reader })).permissionsGranted
    ).toBe(4);
    expectScopeUntouched(scopes);
  });
});

// ------------------------------------------------------------- registry

describe("checker registry", () => {
  const assessedChallengeSlugs = learnTracks.flatMap((track) =>
    track.modules.flatMap((module) =>
      module.units.flatMap((unit) =>
        unit.assessment.kind === "challenge"
          ? [unit.assessment.challengeSlug]
          : []
      )
    )
  );

  it("has a checker for every challenge a unit assesses", () => {
    expect(assessedChallengeSlugs.length).toBeGreaterThan(0);
    for (const slug of assessedChallengeSlugs) {
      expect(getChecker(slug), `no checker registered for ${slug}`).toBeTypeOf(
        "function"
      );
    }
  });

  it("registers no checker the curriculum does not define", () => {
    for (const slug of Object.keys(checkers)) {
      expect(
        getChallenge(slug),
        `${slug} is not a challenge in curriculum.ts`
      ).toBeDefined();
    }
  });
});
