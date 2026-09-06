/**
 * Sales track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const sales: LearnTrack = {
  slug: "sales",
  title: "Sales",
  description:
    "Quote to cash: pricing, orders, shipments, and the invoice at the end.",
  audience: "Sales, estimating, customer service",
  status: "live",
  requiredChallengeSlugs: [
    "sales-create-quote",
    "sales-convert-to-order",
    "sales-quote-to-invoice"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "quotes", count: 7 },
      { topic: "pricing", count: 6 },
      { topic: "orders", count: 7 },
      { topic: "shipping", count: 5 },
      { topic: "billing", count: 5 }
    ]
  },
  challenges: [
    {
      slug: "sales-create-quote",
      trackSlug: "sales",
      title: "Quote a customer",
      brief:
        "Raise a quote for any customer with at least one line, so there is a price on the table.",
      requirements: [
        { key: "quote-exists", label: "A quote you created since starting" },
        { key: "quote-has-line", label: "It has at least one line" }
      ],
      capstone: false
    },
    {
      slug: "sales-convert-to-order",
      trackSlug: "sales",
      title: "Turn the quote into an order",
      brief:
        "Take a quote you raised and convert it into a sales order, then get that order out of Draft.",
      requirements: [
        { key: "quote-exists", label: "A quote you created since starting" },
        {
          key: "order-from-quote",
          label: "A sales order raised from that quote's opportunity"
        },
        { key: "order-confirmed", label: "The order has left Draft" }
      ],
      capstone: false
    },
    {
      slug: "sales-quote-to-invoice",
      trackSlug: "sales",
      title: "Capstone — quote to cash",
      brief:
        "A customer wants parts and wants them billed. Get from a price on a quote to an invoice they can pay. How you get there is up to you.",
      requirements: [
        { key: "quote-exists", label: "A quote you raised" },
        { key: "order-from-quote", label: "A sales order from that quote" },
        { key: "shipment-posted", label: "A posted shipment for the customer" },
        { key: "invoice-posted", label: "A posted sales invoice for them" }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "quoting",
      title: "Quoting",
      description:
        "Putting a number in front of a customer, and standing by it.",
      badgeSlug: "sales-quoting",
      badgeTitle: "Estimator",
      units: [
        {
          slug: "quote-anatomy",
          title: "Anatomy of a quote",
          objective:
            "Read a quote line and say what its status means for whether the price can still move.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/quotes", "Quotes")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "pricing",
          title: "Pricing",
          objective:
            "Predict which price a line takes when a price list, a rule, and a typed price all apply.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/pricing", "Pricing")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "create-a-quote",
          title: "Quote a customer",
          objective: "Raise a real quote with a line, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/quotes", "Quotes")],
          assessment: {
            kind: "challenge",
            challengeSlug: "sales-create-quote"
          }
        }
      ]
    },
    {
      slug: "orders",
      title: "Orders",
      description:
        "The commitment: what converting a quote creates, and why an order's status is not typed.",
      badgeSlug: "sales-orders",
      badgeTitle: "Order taker",
      units: [
        {
          slug: "order-anatomy",
          title: "Anatomy of a sales order",
          objective:
            "Read a sales order line's shipped and invoiced counters and say what is still owed.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/sales-orders", "Sales orders"),
            docsRef("/guides/quote-to-cash", "Quote to cash")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "order-status-is-computed",
          title: "Status is computed",
          objective:
            "Predict a sales order's status from its lines rather than expecting to set it.",
          estimatedMinutes: 12,
          docs: [
            docsRef("/docs/reference/sales-orders", "Sales orders"),
            docsRef("/guides/order-to-cash", "Order to cash")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "convert-to-order",
          title: "Convert the quote",
          objective:
            "Turn your quote into a confirmed sales order, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/sales-orders", "Sales orders")],
          assessment: {
            kind: "challenge",
            challengeSlug: "sales-convert-to-order"
          }
        }
      ]
    },
    {
      slug: "shipping-and-billing",
      title: "Shipping and billing",
      description:
        "Goods out, invoice out, and the counters that connect them.",
      badgeSlug: "sales-fulfilment",
      badgeTitle: "Closer",
      units: [
        {
          slug: "shipments",
          title: "Shipments",
          objective:
            "Say what posting a shipment moves, and what it does to the order behind it.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/shipments", "Shipments"),
            docsRef("/guides/ship", "Shipping")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "sales-invoices",
          title: "Invoicing the customer",
          objective:
            "Explain what a posted sales invoice means, and what it does not mean.",
          estimatedMinutes: 12,
          docs: [
            docsRef("/docs/reference/invoices", "Invoices"),
            docsRef("/guides/order-to-cash", "Order to cash")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "capstone-quote-to-invoice",
          title: "Capstone — quote to cash",
          objective:
            "Run the whole loop yourself: quote, order, shipment, invoice. No instructions.",
          estimatedMinutes: 45,
          docs: [
            docsRef("/guides/quote-to-cash", "Quote to cash"),
            docsRef("/guides/order-to-cash", "Order to cash")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "sales-quote-to-invoice"
          }
        }
      ]
    }
  ]
};
