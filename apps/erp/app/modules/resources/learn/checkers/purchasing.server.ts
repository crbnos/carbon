/**
 * Carbon Learn — Purchasing challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type {
  LearnPurchaseOrderLineRow,
  LearnPurchaseOrderRow,
  LearnReceiptRow
} from "./reader.server";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * "Released" is a SET, never one value. A purchase order's status is computed
 * from its lines — releasing a fully-received order can land it on Completed,
 * and the post-receipt edge function moves it between the To Receive / To
 * Invoice variants without anyone touching a status field. Asserting one exact
 * value would fail a learner who did the work correctly and then kept going.
 */
const RELEASED_PO_STATUSES = new Set([
  "To Receive and Invoice",
  "To Receive",
  "To Invoice",
  "Completed"
]);

const isReleased = (order: LearnPurchaseOrderRow) =>
  RELEASED_PO_STATUSES.has(order.status);

/** A line the learner actually ordered something on. Comments are not lines. */
const isOrderedLine = (line: LearnPurchaseOrderLineRow) =>
  line.purchaseOrderLineType !== "Comment" &&
  line.purchaseQuantity !== null &&
  line.purchaseQuantity > 0;

function countOrderedLines(
  lines: LearnPurchaseOrderLineRow[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    if (!isOrderedLine(line)) continue;
    counts[line.purchaseOrderId] = (counts[line.purchaseOrderId] ?? 0) + 1;
  }
  return counts;
}

type MatchedReceipt = {
  receipt: LearnReceiptRow;
  order: LearnPurchaseOrderRow;
};

/**
 * Pair each receipt with the order it was raised against. `sourceDocumentId` is
 * the order's UUID, not its readable id — matching on the readable id silently
 * matches nothing.
 */
function matchReceiptsToOrders(
  receipts: LearnReceiptRow[],
  orders: LearnPurchaseOrderRow[]
): MatchedReceipt[] {
  const byId = new Map(orders.map((order) => [order.id, order]));
  const matched: MatchedReceipt[] = [];

  for (const receipt of receipts) {
    if (receipt.sourceDocument !== "Purchase Order") continue;
    if (!receipt.sourceDocumentId) continue;
    const order = byId.get(receipt.sourceDocumentId);
    if (!order) continue;
    matched.push({ receipt, order });
  }

  return matched;
}

/**
 * `purchasing-create-release-po` — requirements, in curriculum order:
 * `po-exists`, `po-two-lines`, `po-released`.
 */
export async function checkCreateReleasePo({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const orders = await reader.purchaseOrdersCreatedBy(scope);

  if (orders.length === 0) {
    return fail(
      "po-exists",
      "No purchase order created by you since you started this challenge. Raise one and check again."
    );
  }

  // One batched read for every order's lines — never one read per order.
  const lineCounts = countOrderedLines(
    await reader.purchaseOrderLines(
      scope.companyId,
      orders.map((order) => order.id)
    )
  );

  const withTwoLines = orders.filter(
    (order) => (lineCounts[order.id] ?? 0) >= 2
  );
  if (withTwoLines.length === 0) {
    const newest = orders[0];
    const count = lineCounts[newest.id] ?? 0;
    return fail(
      "po-two-lines",
      `${newest.purchaseOrderId} has ${count} line${count === 1 ? "" : "s"} with a quantity — it needs at least two`
    );
  }

  // Newest first out of the reader, so the first match IS the newest.
  const released = withTwoLines.find(isReleased);
  if (!released) {
    const newest = withTwoLines[0];
    return fail(
      "po-released",
      `${newest.purchaseOrderId} is still ${newest.status} — release it from the order's status menu`
    );
  }

  return {
    passed: true,
    evidence: {
      purchaseOrderId: released.id,
      readableId: released.purchaseOrderId
    }
  };
}

/**
 * `purchasing-receive-po` — requirements, in curriculum order:
 * `po-exists-released`, `receipt-exists`, `receipt-posted`, `receipt-has-quantity`.
 *
 * Evidence `readableId` is the RECEIPT's readable id — the artifact this
 * challenge proves. The order is carried by `purchaseOrderId` (its UUID).
 */
export async function checkReceivePo({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const orders = await reader.purchaseOrdersCreatedBy(scope);
  const releasedOrders = orders.filter(isReleased);

  if (releasedOrders.length === 0) {
    if (orders.length === 0) {
      return fail(
        "po-exists-released",
        "No purchase order created by you since you started this challenge. Raise one and release it first."
      );
    }
    const newest = orders[0];
    return fail(
      "po-exists-released",
      `${newest.purchaseOrderId} is still ${newest.status} — release it before you can receive against it`
    );
  }

  const matched = matchReceiptsToOrders(
    await reader.receiptsCreatedBy(scope),
    releasedOrders
  );

  if (matched.length === 0) {
    return fail(
      "receipt-exists",
      `No receipt against ${releasedOrders[0].purchaseOrderId} yet — create one from the order`
    );
  }

  const posted = matched.filter((match) => match.receipt.status === "Posted");
  if (posted.length === 0) {
    const newest = matched[0];
    return fail(
      "receipt-posted",
      `${newest.receipt.receiptId} is ${newest.receipt.status}, not Posted — post it to bring the goods into stock`
    );
  }

  // One batched read for every posted receipt's lines.
  const lines = await reader.receiptLines(
    scope.companyId,
    posted.map((match) => match.receipt.id)
  );
  const receivedByReceipt = new Set(
    lines
      .filter((line) => line.receivedQuantity > 0)
      .map((line) => line.receiptId)
  );

  const proven = posted.find((match) =>
    receivedByReceipt.has(match.receipt.id)
  );
  if (!proven) {
    const newest = posted[0];
    return fail(
      "receipt-has-quantity",
      `${newest.receipt.receiptId} was posted with nothing received — enter a received quantity on at least one line`
    );
  }

  return {
    passed: true,
    evidence: {
      purchaseOrderId: proven.order.id,
      receiptId: proven.receipt.id,
      readableId: proven.receipt.receiptId
    }
  };
}

type SupplierChain = {
  supplierId: string;
  supplierName: string;
  quoteId?: string;
  order?: LearnPurchaseOrderRow;
  /** Only for the failure message: an order for this supplier still in Draft. */
  unreleasedOrder?: LearnPurchaseOrderRow;
  receipt?: LearnReceiptRow;
  /** Only for the failure message: a receipt that exists but is not Posted. */
  unpostedReceipt?: LearnReceiptRow;
  /** 1 supplier, 2 + quote, 3 + released order, 4 + posted receipt. */
  depth: 1 | 2 | 3 | 4;
};

/**
 * `purchasing-capstone-source-brackets` — requirements, in curriculum order:
 * `supplier-created`, `quote-active`, `po-released-for-supplier`, `receipt-posted`.
 *
 * Chained: the quote must be from the new supplier, the order must be to that
 * same supplier, and the receipt must be against that order. A learner with an
 * Active quote from supplier A and a released order to supplier B has not done
 * this — the whole point of the capstone is the chain.
 */
export async function checkCapstoneSourceBrackets({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const suppliers = await reader.suppliersCreatedSince(scope);

  if (suppliers.length === 0) {
    return fail(
      "supplier-created",
      "No supplier has been created in this company since you started this challenge."
    );
  }

  // Four fixed reads for the whole chain, however many suppliers there are.
  const [quotes, orders, receipts] = await Promise.all([
    reader.supplierQuotesCreatedBy(scope),
    reader.purchaseOrdersCreatedBy(scope),
    reader.receiptsCreatedBy(scope)
  ]);
  const quoteLineCounts = await reader.supplierQuoteLineCount(
    scope.companyId,
    quotes.map((quote) => quote.id)
  );

  const chains = suppliers.map<SupplierChain>((supplier) => {
    const base = { supplierId: supplier.id, supplierName: supplier.name };

    const quote = quotes.find(
      (q) =>
        q.supplierId === supplier.id &&
        q.status === "Active" &&
        (quoteLineCounts[q.id] ?? 0) > 0
    );
    if (!quote) return { ...base, depth: 1 };

    const supplierOrders = orders.filter(
      (order) => order.supplierId === supplier.id
    );
    const releasedOrders = supplierOrders.filter(isReleased);
    if (releasedOrders.length === 0) {
      return {
        ...base,
        quoteId: quote.id,
        unreleasedOrder: supplierOrders[0],
        depth: 2
      };
    }

    const matched = matchReceiptsToOrders(receipts, releasedOrders);
    const posted = matched.find((match) => match.receipt.status === "Posted");
    if (!posted) {
      return {
        ...base,
        quoteId: quote.id,
        order: releasedOrders[0],
        unpostedReceipt: matched[0]?.receipt,
        depth: 3
      };
    }

    return {
      ...base,
      quoteId: quote.id,
      order: posted.order,
      receipt: posted.receipt,
      depth: 4
    };
  });

  // The furthest-along supplier speaks for the learner. Suppliers arrive with
  // the learner's own first, so a tie keeps their own supplier.
  let best = chains[0];
  for (const chain of chains) {
    if (chain.depth > best.depth) best = chain;
  }

  const who = best.supplierName || "your new supplier";

  if (best.depth === 1) {
    return fail(
      "quote-active",
      `No Active supplier quote with a line from ${who} yet — quote the brackets before you order them`
    );
  }

  if (best.depth === 2) {
    const stuck = best.unreleasedOrder;
    return fail(
      "po-released-for-supplier",
      stuck
        ? `${stuck.purchaseOrderId} to ${who} is still ${stuck.status} — release it`
        : `No released purchase order to ${who} yet — raise one for the brackets`
    );
  }

  if (best.depth === 3) {
    const orderId = best.order?.purchaseOrderId ?? "your released order";
    const stuck = best.unpostedReceipt;
    return fail(
      "receipt-posted",
      stuck
        ? `${stuck.receiptId} against ${orderId} is ${stuck.status}, not Posted — post it`
        : `No posted receipt against ${orderId} yet — receive the brackets into stock`
    );
  }

  return {
    passed: true,
    evidence: {
      supplierId: best.supplierId,
      supplierQuoteId: best.quoteId,
      purchaseOrderId: best.order?.id,
      receiptId: best.receipt?.id
    }
  };
}
