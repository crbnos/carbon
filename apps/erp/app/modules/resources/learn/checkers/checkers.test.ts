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
  LearnItemRow,
  LearnPurchaseOrderLineRow,
  LearnPurchaseOrderRow,
  LearnReader,
  LearnReceiptLineRow,
  LearnReceiptRow,
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
    ...overrides
  };

  const scopes: ReaderScope[] = [];
  const batched = {
    purchaseOrderLines: [] as BatchCall[],
    receiptLines: [] as BatchCall[],
    supplierQuoteLineCount: [] as BatchCall[]
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
      const counts: Record<string, number> = {};
      for (const id of ids) {
        const count = data.supplierQuoteLineCounts[id];
        if (count) counts[id] = count;
      }
      return counts;
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
function failureOf(result: Awaited<ReturnType<ReturnType<typeof getChecker>>>) {
  if (result.passed)
    throw new Error("expected the checker to fail, but it passed");
  return result;
}

function evidenceOf(
  result: Awaited<ReturnType<ReturnType<typeof getChecker>>>
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
