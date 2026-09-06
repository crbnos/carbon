/**
 * Purchasing — question bank. SERVER ONLY.
 *
 * The questions lean on the rules the docs flag as counterintuitive, because
 * those are the ones people get wrong in production: status is computed from
 * lines, stock moves without accounting, inspected parts land on hold, the
 * three-way match is on the order line, and a posted bill is not a paid bill.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const PO = `${D}/docs/reference/purchase-orders`;
const RCP = `${D}/docs/reference/receipts`;
const SQ = `${D}/docs/reference/supplier-quotes`;
const INV = `${D}/docs/reference/invoices`;
const SUP = `${D}/docs/reference/suppliers-and-customers`;
const G_RFQ = `${D}/guides/rfq-to-po`;
const G_RCV = `${D}/guides/receive-and-bill`;

export const questions: LearnQuestion[] = [
  // ----------------------------------------------------------- suppliers (15)
  {
    slug: "purchasing.suppliers.01",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "remember",
    kind: "single",
    prompt: "What does a supplier record represent in Carbon?",
    options: [
      { id: "a", text: "A company you buy from" },
      { id: "b", text: "A company you sell to" },
      { id: "c", text: "A warehouse location" },
      { id: "d", text: "A shipping carrier only" }
    ],
    answer: "a",
    explanation:
      "Suppliers are the buy side; customers are the sell side. They share a great deal of structure but face opposite directions.",
    docsUrl: SUP
  },
  {
    slug: "purchasing.suppliers.02",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt:
      "Finalizing a purchase order fails with 'Cannot finalize: supplier is not approved (Active)'. What is wrong?",
    options: [
      { id: "a", text: "The supplier has no contact email" },
      {
        id: "b",
        text: "The company requires approved suppliers and this one is Pending, Inactive, or Rejected"
      },
      { id: "c", text: "The order has no lines" },
      { id: "d", text: "The purchase order number sequence is missing" }
    ],
    answer: "b",
    explanation:
      "When the company requires supplier approval, the supplier's status must be Active before the order can be finalized.",
    docsUrl: PO
  },
  {
    slug: "purchasing.suppliers.03",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt:
      "Converting a supplier quote is blocked with 'supplier is not approved (Active)'. What unblocks it?",
    options: [
      { id: "a", text: "Re-finalizing the quote" },
      { id: "b", text: "Setting the supplier's status to Active" },
      { id: "c", text: "Adding a second quote line" },
      { id: "d", text: "Changing the quote's currency" }
    ],
    answer: "b",
    explanation:
      "Supplier approval gates the Convert to Order action as well as finalizing an order — approve the supplier, then convert.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.suppliers.04",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does Carbon store a supplier's prices on a supplier part rather than on the item itself?",
    options: [
      {
        id: "a",
        text: "Because several suppliers can price the same item differently, so the price belongs to the pairing"
      },
      { id: "b", text: "Because items cannot carry numbers" },
      { id: "c", text: "To avoid currency conversion" },
      { id: "d", text: "Because items are shared across companies" }
    ],
    answer: "a",
    explanation:
      "A supplier part is the item-plus-supplier pairing, which is the only place a vendor-specific price can live without pretending there is one true price for the item.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.suppliers.05",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt:
      "You finalize a purchase order for a supplier in another company and get 'You are not authorized to finalize this purchase order'. Why?",
    options: [
      { id: "a", text: "You lack the purchasing update permission" },
      {
        id: "b",
        text: "The order belongs to a different company than the one you are signed into"
      },
      { id: "c", text: "The supplier is inactive" },
      { id: "d", text: "The order is already finalized" }
    ],
    answer: "b",
    explanation:
      "Documents are company-scoped. Switch to the owning company to act on its orders.",
    docsUrl: PO
  },
  {
    slug: "purchasing.suppliers.06",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "remember",
    kind: "single",
    prompt:
      "What ties a supplier's RFQ, quote, and resulting purchase order together for one exchange?",
    options: [
      { id: "a", text: "The supplier interaction" },
      { id: "b", text: "The item's supplier part" },
      { id: "c", text: "The purchase order number" },
      { id: "d", text: "Nothing — they are independent" }
    ],
    answer: "a",
    explanation:
      "A supplier interaction is the umbrella record so the whole exchange can be traced in one place.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.suppliers.07",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A buyer wants one quote holding five suppliers' prices side by side. What does Carbon actually do?",
    options: [
      { id: "a", text: "Creates one quote with five price columns" },
      {
        id: "b",
        text: "Creates five single-supplier quotes; the comparison is a separate view reading across them"
      },
      { id: "c", text: "Refuses the RFQ" },
      { id: "d", text: "Creates one quote and overwrites it per reply" }
    ],
    answer: "b",
    explanation:
      "A supplier quote is single-supplier by design. Fan an RFQ to five vendors and you get five quotes; the side-by-side comparison reads across the siblings.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.suppliers.08",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt:
      "Which of these is stored per supplier and used to price their goods correctly?",
    options: [
      { id: "a", text: "Their currency" },
      { id: "b", text: "Your base currency" },
      { id: "c", text: "The item's costing method" },
      { id: "d", text: "The company's fiscal calendar" }
    ],
    answer: "a",
    explanation:
      "A supplier carries their own currency, which is why quoted prices are entered in their terms and converted for comparison.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.suppliers.09",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt:
      "You need to send parts to an outside vendor for a plating step and bring them back. Which purchase order type?",
    options: [
      { id: "a", text: "Purchase" },
      { id: "b", text: "Return" },
      { id: "c", text: "Outside Processing" },
      { id: "d", text: "Transfer" }
    ],
    answer: "c",
    explanation:
      "Outside Processing buys a production step rather than an item: the line links to a job operation.",
    docsUrl: PO
  },
  {
    slug: "purchasing.suppliers.10",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "analyze",
    kind: "single",
    prompt: "Why can a purchase order buy an operation rather than an item?",
    options: [
      {
        id: "a",
        text: "Because outsourced production steps are bought work, and the line links to the job operation it covers"
      },
      { id: "b", text: "Because every operation is secretly an item" },
      { id: "c", text: "It cannot — operations are internal only" },
      { id: "d", text: "Because operations are stocked" }
    ],
    answer: "a",
    explanation:
      "Outside processing is a real purchasing case: you are buying a step in the routing, so the PO line points at the job operation.",
    docsUrl: G_RFQ
  },
  {
    slug: "purchasing.suppliers.11",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "remember",
    kind: "single",
    prompt: "What are the three purchase order types?",
    options: [
      { id: "a", text: "Purchase, Return, Outside Processing" },
      { id: "b", text: "Draft, Active, Archived" },
      { id: "c", text: "Standard, Blanket, Contract" },
      { id: "d", text: "Buy, Make, Transfer" }
    ],
    answer: "a",
    explanation:
      "A plain Purchase, a Return to the supplier, or Outside Processing for a bought production step.",
    docsUrl: PO
  },
  {
    slug: "purchasing.suppliers.12",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt:
      "The Finalize/Send button on a supplier quote is disabled. Which of these would explain it?",
    options: [
      {
        id: "a",
        text: "The quote has no lines, or you lack the purchasing update permission"
      },
      { id: "b", text: "The supplier has no website" },
      { id: "c", text: "The quote is in your base currency" },
      { id: "d", text: "The item is serial tracked" }
    ],
    answer: "a",
    explanation:
      "Finalize/Send require the purchasing update permission and at least one line; Send is also disabled once the quote is already Active.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.suppliers.13",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt:
      "Finalizing a quote with notification method Email fails. What is the likely missing piece?",
    options: [
      { id: "a", text: "A supplier contact to send it to" },
      { id: "b", text: "An expiration date" },
      { id: "c", text: "A conversion factor" },
      { id: "d", text: "A purchase order number" }
    ],
    answer: "a",
    explanation:
      "'Supplier contact is required for email' — pick a contact or change the notification method.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.suppliers.14",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which are true of the RFQ and supplier quote relationship? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "A quote can be entered directly with no preceding RFQ"
      },
      {
        id: "b",
        text: "Each supplier's reply to an RFQ becomes its own quote"
      },
      { id: "c", text: "An RFQ is mandatory before any purchase order" },
      { id: "d", text: "Quotes and RFQs hang off a supplier interaction" }
    ],
    answer: ["a", "b", "d"],
    explanation:
      "RFQ and quote are loosely coupled — both optional. You can record pricing directly, and a PO can be raised without either.",
    docsUrl: G_RFQ
  },
  {
    slug: "purchasing.suppliers.15",
    unitSlug: "suppliers",
    topic: "suppliers",
    bloom: "apply",
    kind: "single",
    prompt: "Where does the supplier portal hang in the RFQ flow?",
    options: [
      { id: "a", text: "Off the request" },
      { id: "b", text: "Off the quote" },
      { id: "c", text: "Off the purchase order" },
      { id: "d", text: "Off the supplier record" }
    ],
    answer: "b",
    explanation:
      "The portal hangs off the quote, not the request — the supplier is answering with their own priced document.",
    docsUrl: G_RFQ
  },

  // -------------------------------------------------------------- quotes (18)
  {
    slug: "purchasing.rfq-to-quote.01",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "remember",
    kind: "single",
    prompt: "In which status is a supplier quote editable?",
    options: [
      { id: "a", text: "Draft only" },
      { id: "b", text: "Draft and Active" },
      { id: "c", text: "Any status except Cancelled" },
      { id: "d", text: "Active only" }
    ],
    answer: "a",
    explanation:
      "Draft is the only editable state. Everything past it locks the quote so the comparison's paper trail stays intact.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.02",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "A supplier revises their pricing after you finalized their quote. What is the correct action?",
    options: [
      { id: "a", text: "Reopen the quote and edit the prices" },
      { id: "b", text: "Record the new numbers on a fresh quote" },
      { id: "c", text: "Edit the resulting purchase order instead" },
      { id: "d", text: "Delete the quote and re-import it" }
    ],
    answer: "b",
    explanation:
      "Finalized quotes are locked. A new quote keeps the history of what each supplier offered and when.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.03",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which supplier quote status does the comparison and convert flow read?",
    options: [
      { id: "a", text: "Draft" },
      { id: "b", text: "Active" },
      { id: "c", text: "Expired" },
      { id: "d", text: "Declined" }
    ],
    answer: "b",
    explanation:
      "Active is the finalized, locked state that comparison and Convert to Order read from.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.04",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt: "A quote sits at Expired. What does that tell you?",
    options: [
      { id: "a", text: "The supplier declined to quote" },
      {
        id: "b",
        text: "It is past its expiration date, so the pricing is no longer trustworthy"
      },
      { id: "c", text: "It was withdrawn before going anywhere" },
      { id: "d", text: "It has already been converted" }
    ],
    answer: "b",
    explanation:
      "Expired is a terminal state meaning the prices have aged out. Declined and Cancelled mean different things.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.05",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You type a unit price on a quote line for a supplier who invoices in EUR while your base currency is USD. Which currency is the number you typed?",
    options: [
      { id: "a", text: "USD — Carbon converts as you type" },
      {
        id: "b",
        text: "EUR — the supplier's currency; the base equivalent is derived from the exchange rate"
      },
      { id: "c", text: "Whichever the item's cost record uses" },
      { id: "d", text: "The company's reporting currency" }
    ],
    answer: "b",
    explanation:
      "You type the supplier's numbers. Carbon stores base-currency equivalents from the quote's exchange rate so comparisons are apples to apples.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.06",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You change the exchange rate on a supplier quote header. What happens to the price rows?",
    options: [
      { id: "a", text: "Nothing — they are frozen at entry" },
      {
        id: "b",
        text: "Every price row re-derives its base-currency equivalent"
      },
      { id: "c", text: "The supplier's typed prices are rewritten" },
      { id: "d", text: "The quote is voided" }
    ],
    answer: "b",
    explanation:
      "The base-currency values are generated from the header rate, so changing the rate re-derives them; the supplier's own numbers are untouched.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.07",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "Why is a quote line's requested quantity an array rather than a single number?",
    options: [
      { id: "a", text: "To allow partial receipts" },
      {
        id: "b",
        text: "Because you usually ask for a price at several volumes, each with its own price row"
      },
      { id: "c", text: "To support multiple suppliers on one line" },
      { id: "d", text: "To track backorders" }
    ],
    answer: "b",
    explanation:
      "That is the quantity-break table: a lead time, unit price, and shipping cost per quantity tier.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.08",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "multi",
    prompt:
      "What does a quantity tier on a quote line carry? (Choose all that apply.)",
    options: [
      { id: "a", text: "A unit price" },
      { id: "b", text: "A lead time" },
      { id: "c", text: "A shipping cost" },
      { id: "d", text: "A payment term" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Each quantity gets its own price row: lead time, unit price, and shipping cost. Payment terms live on the supplier, not the tier.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.09",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Converting a quote to an order does something beyond raising the order. What?",
    options: [
      { id: "a", text: "It closes the RFQ" },
      {
        id: "b",
        text: "It writes the quantity-break prices onto the supplier part, teaching Carbon what this vendor charges"
      },
      { id: "c", text: "It posts a receipt" },
      { id: "d", text: "It creates the supplier record" }
    ],
    answer: "b",
    explanation:
      "Converting updates the item's supplier part with the tier prices and sets the headline unit price to the best tier, so the next order already knows the vendor's pricing.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.10",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A supplier quotes in EUR and sells by the 10-pack, while you stock eaches. What does the supplier part's stored price end up as?",
    options: [
      { id: "a", text: "The EUR per-pack price, unchanged" },
      {
        id: "b",
        text: "A per-stock-unit price, divided by both the exchange rate and the conversion factor"
      },
      { id: "c", text: "The USD per-pack price" },
      { id: "d", text: "Zero until the first receipt" }
    ],
    answer: "b",
    explanation:
      "The tier price is divided by the exchange rate and the conversion factor before storage, which is why the per-stock-unit cost still makes sense afterwards.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.11",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt: "When converting a quote, what do you choose?",
    options: [
      { id: "a", text: "Which lines and which quantity tier to buy" },
      { id: "b", text: "The supplier's currency" },
      { id: "c", text: "The receipt location" },
      { id: "d", text: "The invoice due date" }
    ],
    answer: "a",
    explanation:
      "Convert to Order asks which lines and which tier; the supplier, contact, location, and exchange rate carry across from the quote.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.12",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt: "A quote's expiration date is rejected. What is the rule?",
    options: [
      { id: "a", text: "It must be today or later" },
      { id: "b", text: "It must be at least 30 days out" },
      { id: "c", text: "It must be before the order date" },
      { id: "d", text: "It must fall in an open accounting period" }
    ],
    answer: "a",
    explanation:
      "'Expiration date must be today or after' — a quote cannot be born expired.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.13",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "remember",
    kind: "single",
    prompt:
      "What is the difference between a sales quote and a supplier quote?",
    options: [
      { id: "a", text: "None — they are the same record type" },
      {
        id: "b",
        text: "A sales quote is what you send a customer; a supplier quote is what a supplier sends you"
      },
      { id: "c", text: "A sales quote is internal only" },
      { id: "d", text: "A supplier quote cannot be converted" }
    ],
    answer: "b",
    explanation:
      "They face opposite directions. A supplier quote is the buy side, and it is not a sales quote.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.14",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "Deleting a supplier quote is unavailable. Which conditions are required?",
    options: [
      {
        id: "a",
        text: "The purchasing delete permission, an unlocked (Draft) quote, and an employee login"
      },
      { id: "b", text: "Only that the quote is Active" },
      { id: "c", text: "That the supplier is inactive" },
      { id: "d", text: "That the quote has no expiration date" }
    ],
    answer: "a",
    explanation:
      "Delete needs the delete permission plus a Draft quote plus an employee login — a locked quote is history.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.15",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt:
      "'Failed to convert quote to order' appears. Which cause is most consistent with the docs?",
    options: [
      {
        id: "a",
        text: "The quote has no lines, or the supplier's payment/shipping records are missing"
      },
      { id: "b", text: "The item is batch tracked" },
      { id: "c", text: "The exchange rate is 1.0" },
      { id: "d", text: "The RFQ is still open" }
    ],
    answer: "a",
    explanation:
      "Confirm the quote has lines and the supplier's payment and shipping terms are set, then retry.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.16",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt: "What is a G/L Account line on a supplier quote for?",
    options: [
      { id: "a", text: "Pricing non-stock spend that has no item behind it" },
      { id: "b", text: "Recording the supplier's bank details" },
      { id: "c", text: "Splitting a line across two suppliers" },
      { id: "d", text: "Nothing — quotes cannot carry them" }
    ],
    answer: "a",
    explanation:
      "A quote line names an item, or a G/L Account line prices non-stock spend instead.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.17",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "analyze",
    kind: "single",
    prompt:
      "If the quote came from an RFQ, what happens to the order created by converting it?",
    options: [
      { id: "a", text: "It is linked back to that RFQ" },
      { id: "b", text: "It replaces the RFQ" },
      { id: "c", text: "It is unlinked, for auditing reasons" },
      { id: "d", text: "It closes the sibling quotes automatically" }
    ],
    answer: "a",
    explanation:
      "The new order links back to the RFQ so the whole exchange stays traceable.",
    docsUrl: SQ
  },
  {
    slug: "purchasing.rfq-to-quote.18",
    unitSlug: "rfq-to-quote",
    topic: "quotes",
    bloom: "apply",
    kind: "single",
    prompt: "What does a Cancelled supplier quote mean?",
    options: [
      { id: "a", text: "The supplier declined to quote" },
      { id: "b", text: "It was withdrawn before it went anywhere" },
      { id: "c", text: "Its prices aged out" },
      { id: "d", text: "It was converted to an order" }
    ],
    answer: "b",
    explanation:
      "Cancelled is withdrawn; Declined is the supplier refusing to quote; Expired is aged-out pricing.",
    docsUrl: SQ
  },

  // -------------------------------------------------------------- orders (24)
  {
    slug: "purchasing.po-anatomy.01",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "What two independent counters does a purchase order line keep?",
    options: [
      { id: "a", text: "Quantity received and quantity invoiced" },
      { id: "b", text: "Quantity ordered and quantity shipped" },
      { id: "c", text: "Unit price and extended price" },
      { id: "d", text: "Quantity on hand and quantity available" }
    ],
    answer: "a",
    explanation:
      "Receiving and billing advance the same order along separate axes; the line closes only when both are satisfied.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.02",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "A line ordered 50, received 40, invoiced 50. What is `quantityToReceive`?",
    options: [
      { id: "a", text: "0" },
      { id: "b", text: "10" },
      { id: "c", text: "40" },
      { id: "d", text: "50" }
    ],
    answer: "b",
    explanation:
      "`quantityToReceive` is the remainder of the ordered quantity not yet received: 50 − 40 = 10.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.03",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Every line on an order is fully invoiced but only partly received. What status does the order show?",
    options: [
      { id: "a", text: "To Invoice" },
      { id: "b", text: "To Receive" },
      { id: "c", text: "Completed" },
      { id: "d", text: "To Receive and Invoice" }
    ],
    answer: "b",
    explanation:
      "'To Receive' means fully invoiced but still owing receipt. The name states what is still owed, not what is done.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.04",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Every line is fully received but nothing has been billed. What status?",
    options: [
      { id: "a", text: "To Receive" },
      { id: "b", text: "To Invoice" },
      { id: "c", text: "Completed" },
      { id: "d", text: "Closed" }
    ],
    answer: "b",
    explanation:
      "'To Invoice' means fully received, still owing the bill — the mirror of 'To Receive'.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.05",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt: "What does the conversion factor on a purchase order line do?",
    options: [
      { id: "a", text: "Converts the supplier's currency to yours" },
      {
        id: "b",
        text: "Converts the supplier's purchase unit to your stock unit"
      },
      { id: "c", text: "Converts the order date to the posting date" },
      { id: "d", text: "Converts tax-inclusive prices to net" }
    ],
    answer: "b",
    explanation:
      "Buy by the box, stock by the each: the factor lets the order stay in the supplier's terms while inventory moves in yours.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.po-anatomy.06",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You buy 3 boxes of 100 fasteners with a conversion factor of 100 and receive all 3. How much stock lands?",
    options: [
      { id: "a", text: "3 units" },
      { id: "b", text: "100 units" },
      { id: "c", text: "300 units" },
      { id: "d", text: "It depends on the currency" }
    ],
    answer: "c",
    explanation:
      "Posting multiplies the outstanding purchase quantity by the factor, so stock and the item ledger move in your inventory unit: 3 × 100.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.po-anatomy.07",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "You try to edit lines on an order at 'To Receive and Invoice' and are refused. Why?",
    options: [
      { id: "a", text: "You lack permission" },
      {
        id: "b",
        text: "The order is locked from release onward; only Draft is freely editable"
      },
      { id: "c", text: "The supplier is inactive" },
      { id: "d", text: "A receipt exists" }
    ],
    answer: "b",
    explanation:
      "A purchase order locks at To Receive, To Receive and Invoice, To Invoice, Completed, and Closed. Reopen it for structural changes.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.08",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "'This line cannot be received' appears on a line. What kind of line is it?",
    options: [
      { id: "a", text: "A Part line" },
      {
        id: "b",
        text: "A comment or G/L account line — only item lines carry a receivable quantity"
      },
      { id: "c", text: "A line with a conversion factor" },
      { id: "d", text: "An outside processing line" }
    ],
    answer: "b",
    explanation:
      "Comment and G/L account lines carry no receivable quantity; only item lines can be received.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.09",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "Which two boolean flags on a line decide whether it is done?",
    options: [
      { id: "a", text: "`receivedComplete` and `invoicedComplete`" },
      { id: "b", text: "`posted` and `closed`" },
      { id: "c", text: "`approved` and `sent`" },
      { id: "d", text: "`active` and `locked`" }
    ],
    answer: "a",
    explanation:
      "Only when both flags are true is the line done, and those flags are exactly what the order's status rolls up.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.po-anatomy.10",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "Short-closing receiving on a line fails with 'Receiving can only be closed or reopened on a released purchase order'. What is required?",
    options: [
      { id: "a", text: "The order must be released first" },
      { id: "b", text: "The line must be fully invoiced" },
      { id: "c", text: "A receipt must exist" },
      { id: "d", text: "The supplier must be approved" }
    ],
    answer: "a",
    explanation:
      "Short-closing applies only once the order is released — at To Receive, To Receive and Invoice, To Invoice, or Completed.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.11",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "'This line has no outstanding quantity to receive' — what does it mean?",
    options: [
      {
        id: "a",
        text: "The line is already fully received; there is nothing left to short-close"
      },
      { id: "b", text: "The line was deleted" },
      { id: "c", text: "The order is in Draft" },
      { id: "d", text: "The item is non-inventory" }
    ],
    answer: "a",
    explanation:
      "Nothing remains to close. If more goods are genuinely expected, reopen receiving on the line.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-anatomy.12",
    unitSlug: "po-anatomy",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A purchase order line is compared to a sales order line 'in reverse'. What does that mean?",
    options: [
      {
        id: "a",
        text: "It keeps two counters that must both be satisfied, but for goods coming in and bills arriving"
      },
      { id: "b", text: "It is numbered backwards" },
      { id: "c", text: "It reduces inventory instead of raising it" },
      { id: "d", text: "It is created by the supplier" }
    ],
    answer: "a",
    explanation:
      "Both sides keep two independent counters and close only when both complete — one faces the customer, the other the supplier.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.01",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "How is a purchase order's status determined?",
    options: [
      { id: "a", text: "The buyer sets it from a dropdown" },
      {
        id: "b",
        text: "It is computed from the state of its lines, never set by hand"
      },
      { id: "c", text: "It follows the supplier's confirmation" },
      { id: "d", text: "It is copied from the quote" }
    ],
    answer: "b",
    explanation:
      "Status is derived from the lines every time. That is why you assert on line state, not on a status you expect to type.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.02",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "An order is confirmed but nothing has been received or billed. Which status?",
    options: [
      { id: "a", text: "Draft" },
      { id: "b", text: "To Receive and Invoice" },
      { id: "c", text: "Planned" },
      { id: "d", text: "Completed" }
    ],
    answer: "b",
    explanation:
      "'To Receive and Invoice' is the confirmed-but-untouched state: both axes still owe something.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.03",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt: "What does the 'Planned' status mean on a purchase order?",
    options: [
      { id: "a", text: "It was suggested by planning" },
      { id: "b", text: "It is waiting for sign-off" },
      { id: "c", text: "It has a promised date" },
      { id: "d", text: "It is scheduled to be emailed" }
    ],
    answer: "a",
    explanation:
      "Planned orders are planning's suggestions; 'To Review' is a planning-suggested order awaiting review before it is sent.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.04",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An order sits at 'Needs Approval' and the approver declines. Where does it land?",
    options: [
      { id: "a", text: "Draft" },
      { id: "b", text: "Closed" },
      { id: "c", text: "Rejected" },
      { id: "d", text: "To Review" }
    ],
    answer: "c",
    explanation:
      "Needs Approval is amount-gated sign-off; rejection lands on Rejected, a terminal state.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.05",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt: "Why would an order be held at 'Needs Approval'?",
    options: [
      { id: "a", text: "The supplier is new" },
      {
        id: "b",
        text: "It is at or above a set amount that requires sign-off"
      },
      { id: "c", text: "It has more than ten lines" },
      { id: "d", text: "The item is serial tracked" }
    ],
    answer: "b",
    explanation:
      "Approval is amount-gated: orders at or above a configured amount wait for sign-off before they can be sent.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.06",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A buyer insists the order 'should be Completed' because everything arrived, but it reads 'To Invoice'. Who is right?",
    options: [
      { id: "a", text: "The buyer — arrival completes an order" },
      {
        id: "b",
        text: "Carbon — Completed needs both fully received AND fully invoiced; the bill is still outstanding"
      },
      { id: "c", text: "Neither; it should read Closed" },
      { id: "d", text: "The buyer, once a receipt is posted" }
    ],
    answer: "b",
    explanation:
      "Completed means both axes are satisfied. Fully received with billing outstanding is exactly 'To Invoice'.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.07",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "remember",
    kind: "single",
    prompt: "Which two purchase order statuses are terminal?",
    options: [
      { id: "a", text: "Closed and Rejected" },
      { id: "b", text: "Completed and Closed" },
      { id: "c", text: "Draft and Planned" },
      { id: "d", text: "To Review and Needs Approval" }
    ],
    answer: "a",
    explanation:
      "Closed means ended; Rejected means sign-off was declined. Completed is an end state of the normal flow but not marked terminal.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.08",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A hands-on exercise asks you to prove an order was released. Which check is most robust?",
    options: [
      {
        id: "a",
        text: "Assert the status equals 'To Receive and Invoice' exactly"
      },
      {
        id: "b",
        text: "Assert the status is any of the released set, because receiving or billing may already have advanced it"
      },
      { id: "c", text: "Assert the order has a PDF" },
      { id: "d", text: "Assert the supplier is Active" }
    ],
    answer: "b",
    explanation:
      "Because status is recomputed from lines, an order released and then partly received is no longer at the initial value — assert membership in the released set.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.09",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt: "Which statuses lock a purchase order from structural edits?",
    options: [
      { id: "a", text: "Only Closed" },
      {
        id: "b",
        text: "To Receive, To Receive and Invoice, To Invoice, Completed, and Closed"
      },
      { id: "c", text: "Draft and Planned" },
      { id: "d", text: "Needs Approval only" }
    ],
    answer: "b",
    explanation:
      "From release onward the order is locked; only Draft and pre-release orders are freely editable.",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.10",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt:
      "'Failed to finalize purchase order' with no further detail. Which underlying causes does the documentation name?",
    options: [
      {
        id: "a",
        text: "No PO number sequence configured, or a PDF/email step failing"
      },
      { id: "b", text: "The accounting period is closed" },
      { id: "c", text: "The item has no method" },
      { id: "d", text: "The supplier has no quote" }
    ],
    answer: "a",
    explanation:
      "It is a generic wrapper: check for a missing PO sequence for the company, or a failing PDF/email step (which have their own messages).",
    docsUrl: PO
  },
  {
    slug: "purchasing.po-status-is-computed.11",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which events can move a purchase order's status without anyone editing the order? (Choose all that apply.)",
    options: [
      { id: "a", text: "Posting a receipt against it" },
      { id: "b", text: "Posting a purchase invoice against it" },
      { id: "c", text: "Renaming the supplier" },
      { id: "d", text: "Changing the company's base currency" }
    ],
    answer: ["a", "b"],
    explanation:
      "Both posting events recompute the line counters and therefore the order's status. Renaming a supplier changes no quantities.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.po-status-is-computed.12",
    unitSlug: "po-status-is-computed",
    topic: "orders",
    bloom: "apply",
    kind: "single",
    prompt: "What does 'Closed' mean, as distinct from 'Completed'?",
    options: [
      {
        id: "a",
        text: "Ended — regardless of whether both axes were satisfied"
      },
      { id: "b", text: "Fully received and invoiced" },
      { id: "c", text: "Awaiting sign-off" },
      { id: "d", text: "Rejected by the approver" }
    ],
    answer: "a",
    explanation:
      "Completed is the satisfied end state; Closed simply means the order has ended and is terminal.",
    docsUrl: PO
  },

  // ----------------------------------------------------------- receiving (18)
  {
    slug: "purchasing.receive-goods.01",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "remember",
    kind: "single",
    prompt: "What turns a delivery into stock on hand?",
    options: [
      { id: "a", text: "Creating the receipt" },
      { id: "b", text: "Posting the receipt" },
      { id: "c", text: "Emailing the supplier" },
      { id: "d", text: "Posting the purchase invoice" }
    ],
    answer: "b",
    explanation:
      "Creating a receipt changes nothing on hand. Posting is the event: stock comes in through the item ledger and the order advances.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.02",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Accounting is switched off for the company. You post a receipt. What happens?",
    options: [
      { id: "a", text: "Nothing — posting requires accounting" },
      {
        id: "b",
        text: "Inventory still updates; only the ledger entries are skipped"
      },
      { id: "c", text: "The receipt is queued until accounting is enabled" },
      { id: "d", text: "Stock updates and a journal is written anyway" }
    ],
    answer: "b",
    explanation:
      "Posting a receipt always updates inventory. The accounting entries are written only when accounting is enabled — the two advance on different switches.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.receive-goods.03",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You receive an item flagged for inspection. Where does the stock land?",
    options: [
      { id: "a", text: "Straight into available stock" },
      {
        id: "b",
        text: "On Hold, with an inbound inspection opened at Pending"
      },
      { id: "c", text: "It is rejected at the door" },
      { id: "d", text: "In the supplier's consignment bin" }
    ],
    answer: "b",
    explanation:
      "Inspected parts are received but quarantined: units land On Hold and do not become available stock until the inspection clears.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.receive-goods.04",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "remember",
    kind: "single",
    prompt: "What are the four receipt statuses?",
    options: [
      { id: "a", text: "Draft, Pending, Posted, Voided" },
      { id: "b", text: "Draft, Active, Archived, Closed" },
      { id: "c", text: "Open, Partial, Complete, Cancelled" },
      { id: "d", text: "New, Sent, Received, Billed" }
    ],
    answer: "a",
    explanation:
      "Draft (being prepared), Pending (queued to post), Posted (inventory increased), Voided (reversed after posting).",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.05",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt: "Posting fails with 'Receipt is empty'. What is missing?",
    options: [
      { id: "a", text: "A supplier contact" },
      { id: "b", text: "A received quantity above zero on at least one line" },
      { id: "c", text: "A posting date" },
      { id: "d", text: "A location" }
    ],
    answer: "b",
    explanation:
      "The post dialog blocks when no line has a received quantity above zero (and no fixed-asset line is marked received).",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.06",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt:
      "A serial-tracked line will not post: 'Serial numbers are missing'. What is required?",
    options: [
      { id: "a", text: "One serial for the whole line" },
      { id: "b", text: "A serial number for every received unit" },
      { id: "c", text: "A batch number instead" },
      { id: "d", text: "The supplier's own serials in a note" }
    ],
    answer: "b",
    explanation:
      "Serial tracking is one record per unit, so every received unit needs its serial before the receipt can post.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.07",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt: "You try to delete a posted receipt. What does Carbon say?",
    options: [
      { id: "a", text: "It deletes with a warning" },
      {
        id: "b",
        text: "'Cannot delete a posted receipt' — void it instead, which writes reversing entries"
      },
      { id: "c", text: "It archives it silently" },
      { id: "d", text: "It requires the delete permission only" }
    ],
    answer: "b",
    explanation:
      "A posted receipt is history. Only Draft and Pending receipts can be deleted; posted ones are voided.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.08",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt: "Which receipts can be voided?",
    options: [
      { id: "a", text: "Only those at Posted" },
      { id: "b", text: "Draft and Pending" },
      { id: "c", text: "Any receipt" },
      { id: "d", text: "Only those created from an invoice" }
    ],
    answer: "a",
    explanation:
      "'Can only void posted receipts' — a Draft or Pending receipt has nothing to reverse and can be edited or deleted instead.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.09",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Voiding a receipt is refused: 'Cannot void a receipt created by a purchase invoice.' What is the fix?",
    options: [
      { id: "a", text: "Delete the receipt" },
      {
        id: "b",
        text: "Void the purchase invoice, and the receipt reverses with it"
      },
      { id: "c", text: "Reopen the purchase order" },
      { id: "d", text: "Post a negative receipt" }
    ],
    answer: "b",
    explanation:
      "That receipt was generated by posting an invoice, so it must be reversed through the invoice that created it.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.10",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "analyze",
    kind: "single",
    prompt:
      "When accounting is on, what does posting a receipt do in the ledger?",
    options: [
      {
        id: "a",
        text: "Debits inventory (or WIP for outside processing) and credits a goods-received-not-invoiced accrual"
      },
      { id: "b", text: "Debits accounts payable and credits cash" },
      { id: "c", text: "Credits inventory and debits COGS" },
      { id: "d", text: "Nothing until the invoice posts" }
    ],
    answer: "a",
    explanation:
      "The GR/IR accrual is what the supplier invoice later clears — it holds the value between goods arriving and the bill arriving.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.11",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt: "How does a receipt line relate to a purchase order line?",
    options: [
      { id: "a", text: "It soft-links back to the order line it fulfils" },
      { id: "b", text: "It replaces the order line" },
      { id: "c", text: "There is no relationship" },
      { id: "d", text: "It links to the invoice line instead" }
    ],
    answer: "a",
    explanation:
      "Creating a receipt from the order pre-fills it from the outstanding lines and links each receipt line back to its order line.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.12",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt:
      "'Failed to post receipt' with no detail. Which two causes does the documentation name first?",
    options: [
      {
        id: "a",
        text: "The accounting period for the posting date is closed or locked, or default accounts are not configured"
      },
      { id: "b", text: "The supplier is inactive, or the PO is in Draft" },
      { id: "c", text: "The item has no method, or no revision" },
      { id: "d", text: "The user lacks the inventory view permission" }
    ],
    answer: "a",
    explanation:
      "Check the period first, then the company's default accounts (inventory, goods received not invoiced).",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.13",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "remember",
    kind: "single",
    prompt:
      "Besides a purchase order, what else can a receipt be raised against?",
    options: [
      { id: "a", text: "An inbound transfer" },
      { id: "b", text: "A sales quote" },
      { id: "c", text: "A job routing" },
      { id: "d", text: "Nothing else" }
    ],
    answer: "a",
    explanation:
      "One receipt model serves several sources — most often a purchase order, but also inbound transfers.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.14",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt: "A batch-tracked line blocks posting. What is missing?",
    options: [
      { id: "a", text: "A serial number per unit" },
      { id: "b", text: "A batch number on the line's batch properties" },
      { id: "c", text: "An inspection record" },
      { id: "d", text: "A conversion factor" }
    ],
    answer: "b",
    explanation:
      "'Batch number is required' — fill it in on the line's batch properties before posting.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.15",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "analyze",
    kind: "single",
    prompt:
      "What ledger document type does received stock enter the item ledger as?",
    options: [
      { id: "a", text: "Purchase Receipt" },
      { id: "b", text: "Purchase Invoice" },
      { id: "c", text: "Inventory Adjustment" },
      { id: "d", text: "Transfer Receipt" }
    ],
    answer: "a",
    explanation:
      "Posting brings stock in through the item ledger as a Purchase Receipt, which is how the movement is traceable later.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.receive-goods.16",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt: "What does a receipt at 'Pending' mean?",
    options: [
      { id: "a", text: "Queued to post" },
      { id: "b", text: "Awaiting inspection" },
      { id: "c", text: "Partially received" },
      { id: "d", text: "Waiting for the invoice" }
    ],
    answer: "a",
    explanation:
      "Pending is a branch state meaning queued to post — nothing has hit inventory yet.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.17",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "analyze",
    kind: "multi",
    prompt: "Posting a receipt does which of these? (Choose all that apply.)",
    options: [
      { id: "a", text: "Adds the quantity to inventory" },
      { id: "b", text: "Raises the order line's received quantity" },
      { id: "c", text: "Advances the purchase order's status" },
      { id: "d", text: "Marks the supplier invoice Paid" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Posting moves stock, raises the counter, and recomputes the order. Payment is an entirely separate posted document.",
    docsUrl: RCP
  },
  {
    slug: "purchasing.receive-goods.18",
    unitSlug: "receive-goods",
    topic: "receiving",
    bloom: "apply",
    kind: "single",
    prompt: "Is a receipt required before you can bill a purchase order?",
    options: [
      { id: "a", text: "Yes — always" },
      {
        id: "b",
        text: "No — a direct invoice can create its own receipt as it posts"
      },
      { id: "c", text: "Only for serial-tracked items" },
      { id: "d", text: "Only when accounting is enabled" }
    ],
    answer: "b",
    explanation:
      "There is deliberately no invoice-to-receipt link, and a receipt is not a precondition for billing.",
    docsUrl: G_RCV
  },

  // ----------------------------------------------------------- invoicing (15)
  {
    slug: "purchasing.three-way-match.01",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Where does Carbon reconcile the order, the receipt, and the supplier's bill?",
    options: [
      { id: "a", text: "On a receipt-to-invoice match record" },
      {
        id: "b",
        text: "Through the quantities on their shared purchase order line"
      },
      { id: "c", text: "On the supplier's account" },
      { id: "d", text: "In a nightly reconciliation job" }
    ],
    answer: "b",
    explanation:
      "The three-way match is on the order line, not a receipt record. There is deliberately no direct invoice-to-receipt link.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.three-way-match.02",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "analyze",
    kind: "single",
    prompt: "You post a purchase invoice. What status does it land on?",
    options: [
      { id: "a", text: "Paid" },
      { id: "b", text: "Open" },
      { id: "c", text: "Submitted" },
      { id: "d", text: "Closed" }
    ],
    answer: "b",
    explanation:
      "Posting never marks an invoice Paid. A purchase invoice lands on Open (the sales side calls the same state Submitted).",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.03",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "apply",
    kind: "single",
    prompt: "What actually flips a supplier bill to Paid?",
    options: [
      { id: "a", text: "Editing the status field" },
      {
        id: "b",
        text: "Posting a payment (a Disbursement) and applying it through a settlement"
      },
      { id: "c", text: "Posting the receipt" },
      { id: "d", text: "Closing the purchase order" }
    ],
    answer: "b",
    explanation:
      "A payment is its own posted entity, applied via a settlement. Paid is derived from what has been applied.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.04",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Posting a purchase invoice clears the GR/IR accrual. At which cost?",
    options: [
      { id: "a", text: "The invoice's price" },
      {
        id: "b",
        text: "The receipt's cost, with any difference booked to purchase price variance"
      },
      { id: "c", text: "The item's standard cost" },
      { id: "d", text: "The supplier quote's price" }
    ],
    answer: "b",
    explanation:
      "The accrual clears at the receipt's cost, and the difference between order price and bill goes to a variance account.",
    docsUrl: G_RCV
  },
  {
    slug: "purchasing.three-way-match.05",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "remember",
    kind: "single",
    prompt: "Which payment kind settles a purchase invoice?",
    options: [
      { id: "a", text: "A Receipt (money in)" },
      { id: "b", text: "A Disbursement (money out)" },
      { id: "c", text: "Either" },
      { id: "d", text: "A journal entry" }
    ],
    answer: "b",
    explanation:
      "A Disbursement is money out to a supplier. Applying a customer Receipt to a supplier bill errors out.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.06",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "apply",
    kind: "single",
    prompt:
      "A settlement leaves a balance of half a cent on a supplier bill. What does Carbon do?",
    options: [
      { id: "a", text: "Leaves it Partially Paid forever" },
      {
        id: "b",
        text: "Treats the invoice as fully Paid and reads the balance as zero"
      },
      { id: "c", text: "Rounds the next invoice up" },
      { id: "d", text: "Blocks the settlement" }
    ],
    answer: "b",
    explanation:
      "Carbon forgives dust: a balance smaller than the currency can represent is treated as Paid rather than sitting a fraction short.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.07",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "An invoice settlement carries which amounts? (Choose all that apply.)",
    options: [
      { id: "a", text: "Applied" },
      { id: "b", text: "Discount" },
      { id: "c", text: "Write-off" },
      { id: "d", text: "Tax" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Applied, discount, and write-off — at least one must be positive. A memo-sourced settlement can only carry an applied amount.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.08",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "apply",
    kind: "single",
    prompt:
      "Which line type is available on a purchase invoice but not a sales invoice?",
    options: [
      { id: "a", text: "G/L Account" },
      { id: "b", text: "Fixed Asset" },
      { id: "c", text: "Comment" },
      { id: "d", text: "Service" }
    ],
    answer: "a",
    explanation:
      "A G/L Account line books a cost straight to a ledger account — freight or a fee with no item behind it. Sales invoices carry Fixed Asset lines instead.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.09",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "apply",
    kind: "single",
    prompt:
      "You try to void a purchase invoice with payments applied. What happens?",
    options: [
      { id: "a", text: "It voids and unapplies automatically" },
      {
        id: "b",
        text: "It is refused until the payments are reversed or unapplied"
      },
      { id: "c", text: "It voids only the unpaid portion" },
      { id: "d", text: "It converts to a debit memo" }
    ],
    answer: "b",
    explanation:
      "'Cannot void a purchase invoice with payments applied. Reverse the payment first.'",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.10",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A posted payment was applied to the wrong invoice. How do you fix it?",
    options: [
      { id: "a", text: "Edit its applications" },
      { id: "b", text: "Void the payment and re-enter it" },
      { id: "c", text: "Delete the payment" },
      { id: "d", text: "Post a second payment for a negative amount" }
    ],
    answer: "b",
    explanation:
      "Applications are frozen once a payment is posted — 'Applications can only be edited while the payment is Draft'.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.11",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "apply",
    kind: "single",
    prompt:
      "What settles a supplier bill without moving cash, and what does it do to the bill's status?",
    options: [
      { id: "a", text: "A debit memo; the bill reads Debit Note Issued" },
      { id: "b", text: "A credit memo; the bill reads Credit Note Issued" },
      { id: "c", text: "A journal entry; the bill reads Voided" },
      { id: "d", text: "Nothing can settle without cash" }
    ],
    answer: "a",
    explanation:
      "On the supplier side a memo-settled invoice reads Debit Note Issued; Credit Note Issued is the customer-invoice equivalent.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.12",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A payment's cash total exceeds everything it applies to. Is that allowed?",
    options: [
      { id: "a", text: "No — it is blocked" },
      {
        id: "b",
        text: "Yes — the excess stays as an unapplied credit on the party's account"
      },
      { id: "c", text: "Yes, but only for customers" },
      { id: "d", text: "Only if a write-off covers the difference" }
    ],
    answer: "b",
    explanation:
      "Over-applying to a single invoice is blocked, but a payment may carry more cash than it applies; the excess is available for a later invoice.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.13",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "apply",
    kind: "single",
    prompt:
      "You try to delete a purchase invoice that has been posted. What does Carbon require instead?",
    options: [
      { id: "a", text: "Void it, which writes reversing entries" },
      { id: "b", text: "Archive it" },
      { id: "c", text: "Reopen it to Draft first" },
      { id: "d", text: "Close the purchase order" }
    ],
    answer: "a",
    explanation:
      "Only Draft invoices can be deleted. Once posted, void writes reversing entries rather than erasing history.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.14",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "apply",
    kind: "single",
    prompt: "Which invoice statuses are computed rather than set by hand?",
    options: [
      { id: "a", text: "Overdue, Partially Paid, and Paid" },
      { id: "b", text: "Draft and Pending" },
      { id: "c", text: "Voided" },
      { id: "d", text: "Open" }
    ],
    answer: "a",
    explanation:
      "Those three are derived from the invoice's settlements and due date — an unpaid invoice past `dateDue` reads Overdue.",
    docsUrl: INV
  },
  {
    slug: "purchasing.three-way-match.15",
    unitSlug: "three-way-match",
    topic: "invoicing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A purchase invoice is drawn from an order. Which lines does Carbon keep?",
    options: [
      { id: "a", text: "All lines, always" },
      { id: "b", text: "The lines that still have something to bill" },
      { id: "c", text: "Only lines already received" },
      { id: "d", text: "Only lines with a G/L account" }
    ],
    answer: "b",
    explanation:
      "Carbon keeps the lines with something left to bill and opens the invoice at Draft, linking each line back to its order line.",
    docsUrl: INV
  }
];
