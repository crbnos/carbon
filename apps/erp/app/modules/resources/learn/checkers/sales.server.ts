/**
 * Carbon Learn — Sales challenge checkers.
 *
 * Server-only: never import this from the module barrel. Each checker returns
 * the FIRST unmet requirement in the order the curriculum lists it, so the
 * learner is told the next thing to do rather than everything at once.
 */

import type { LearnCheckResult } from "../types";
import type { LearnQuoteRow, LearnSalesOrderRow } from "./reader.server";
import type { CheckerContext } from "./shared.server";
import { fail } from "./shared.server";

/**
 * A sales order's status is computed from its lines, exactly as a purchase
 * order's is — so "has left Draft" is a SET. Needs Approval is included on
 * purpose: a company that requires approval leaves a correctly-converted order
 * sitting there, and failing that learner would be failing the company's own
 * configuration rather than their work.
 */
const RELEASED_ORDER_STATUSES = new Set([
  "Needs Approval",
  "Confirmed",
  "In Progress",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Completed",
  "Invoiced",
  "Closed"
]);

/** Posting is what makes a shipment or an invoice real; the rest is a draft. */
const POSTED = "Posted";

const POSTED_SALES_INVOICE_STATUSES = new Set([
  "Submitted",
  "Paid",
  "Partially Paid",
  "Overdue"
]);

/**
 * `salesOrder` has NO `quoteId` column — the only link the two share is
 * `opportunityId`, which conversion carries across. Matching on anything else
 * silently matches nothing.
 */
function ordersFromQuotes(
  orders: LearnSalesOrderRow[],
  quotes: LearnQuoteRow[]
): Array<{ order: LearnSalesOrderRow; quote: LearnQuoteRow }> {
  const byOpportunity = new Map(
    quotes
      .filter((quote) => quote.opportunityId)
      .map((quote) => [quote.opportunityId as string, quote])
  );

  const matched: Array<{ order: LearnSalesOrderRow; quote: LearnQuoteRow }> =
    [];
  for (const order of orders) {
    if (!order.opportunityId) continue;
    const quote = byOpportunity.get(order.opportunityId);
    if (!quote) continue;
    matched.push({ order, quote });
  }
  return matched;
}

/**
 * `sales-create-quote` — requirements, in curriculum order:
 * `quote-exists`, `quote-has-line`.
 */
export async function checkCreateQuote({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const quotes = await reader.quotesCreatedBy(scope);

  if (quotes.length === 0) {
    return fail(
      "quote-exists",
      "No quote created by you since you started this challenge. Raise one and check again."
    );
  }

  const lineCounts = await reader.quoteLineCount(
    scope.companyId,
    quotes.map((quote) => quote.id)
  );

  const withLine = quotes.find((quote) => (lineCounts[quote.id] ?? 0) >= 1);
  if (!withLine) {
    const newest = quotes[0];
    return fail(
      "quote-has-line",
      `${newest.quoteId || "Your quote"} has no lines — add at least one so there is something to price`
    );
  }

  return {
    passed: true,
    evidence: { quoteId: withLine.id, readableId: withLine.quoteId }
  };
}

/**
 * `sales-convert-to-order` — requirements, in curriculum order:
 * `quote-exists`, `order-from-quote`, `order-confirmed`.
 */
export async function checkConvertToOrder({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const quotes = await reader.quotesCreatedBy(scope);

  if (quotes.length === 0) {
    return fail(
      "quote-exists",
      "No quote created by you since you started this challenge. Raise one first, then convert it."
    );
  }

  const orders = await reader.salesOrdersCreatedBy(scope);
  const matched = ordersFromQuotes(orders, quotes);

  if (matched.length === 0) {
    return fail(
      "order-from-quote",
      `No sales order raised from ${quotes[0].quoteId || "your quote"} — convert the quote rather than raising a fresh order`
    );
  }

  const released = matched.find(({ order }) =>
    RELEASED_ORDER_STATUSES.has(order.status)
  );
  if (!released) {
    const newest = matched[0].order;
    return fail(
      "order-confirmed",
      `${newest.salesOrderId || "Your sales order"} is still ${newest.status || "Draft"} — confirm it`
    );
  }

  return {
    passed: true,
    evidence: {
      quoteId: released.quote.id,
      salesOrderId: released.order.id,
      readableId: released.order.salesOrderId
    }
  };
}

/**
 * `sales-quote-to-invoice` (capstone) — requirements, in curriculum order:
 * `quote-exists`, `order-from-quote`, `shipment-posted`, `invoice-posted`.
 *
 * The shipment and invoice are matched to the ORDER'S CUSTOMER rather than to
 * the order itself: a shipment carries its source document, but an invoice
 * raised from a shipment does not carry the order, and requiring the learner to
 * find the one path that preserves the link would be testing the UI, not the
 * skill.
 */
export async function checkQuoteToInvoice({
  scope,
  reader
}: CheckerContext): Promise<LearnCheckResult> {
  const quotes = await reader.quotesCreatedBy(scope);

  if (quotes.length === 0) {
    return fail(
      "quote-exists",
      "No quote created by you since you started this challenge."
    );
  }

  const orders = await reader.salesOrdersCreatedBy(scope);
  const matched = ordersFromQuotes(orders, quotes);

  if (matched.length === 0) {
    return fail(
      "order-from-quote",
      `No sales order raised from ${quotes[0].quoteId || "your quote"} yet.`
    );
  }

  const customerIds = new Set(
    matched.map(({ order }) => order.customerId).filter(Boolean)
  );

  const shipments = await reader.shipmentsCreatedBy(scope);
  const shipped = shipments.find(
    (shipment) =>
      shipment.status === POSTED &&
      shipment.customerId !== null &&
      customerIds.has(shipment.customerId)
  );
  if (!shipped) {
    return fail(
      "shipment-posted",
      `Nothing posted out to the customer on ${matched[0].order.salesOrderId || "that order"} yet — post a shipment`
    );
  }

  const invoices = await reader.salesInvoicesCreatedBy(scope);
  const invoiced = invoices.find(
    (invoice) =>
      POSTED_SALES_INVOICE_STATUSES.has(invoice.status) &&
      customerIds.has(invoice.customerId)
  );
  if (!invoiced) {
    return fail(
      "invoice-posted",
      "The goods have shipped but nothing has been billed — post a sales invoice for that customer"
    );
  }

  return {
    passed: true,
    evidence: {
      quoteId: matched[0].quote.id,
      salesOrderId: matched[0].order.id,
      shipmentId: shipped.id,
      salesInvoiceId: invoiced.id,
      invoiceReadableId: invoiced.invoiceId
    }
  };
}
