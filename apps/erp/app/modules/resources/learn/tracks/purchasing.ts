/**
 * Purchasing track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const purchasing: LearnTrack = {
  slug: "purchasing",
  title: "Purchasing",
  description:
    "Source it, order it, receive it, and match the bill — with the rules that surprise people.",
  audience: "Buyers, purchasing managers, anyone who raises a PO",
  status: "live",
  requiredChallengeSlugs: [
    "purchasing-create-release-po",
    "purchasing-receive-po",
    "purchasing-capstone-source-brackets"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "suppliers", count: 5 },
      { topic: "quotes", count: 6 },
      { topic: "orders", count: 8 },
      { topic: "receiving", count: 6 },
      { topic: "invoicing", count: 5 }
    ]
  },
  challenges: [
    {
      slug: "purchasing-create-release-po",
      trackSlug: "purchasing",
      title: "Create and release a purchase order",
      brief:
        "Raise a purchase order to any supplier with at least two lines, then release it so the supplier can be sent it.",
      requirements: [
        {
          key: "po-exists",
          label: "A purchase order you created since starting"
        },
        {
          key: "po-two-lines",
          label: "It has at least two lines with a quantity"
        },
        { key: "po-released", label: "It has left Draft" }
      ],
      capstone: false
    },
    {
      slug: "purchasing-receive-po",
      trackSlug: "purchasing",
      title: "Receive against a purchase order",
      brief:
        "Take one of your released purchase orders and receive some of it: create the receipt and post it.",
      requirements: [
        {
          key: "po-exists-released",
          label: "A released purchase order you created"
        },
        { key: "receipt-exists", label: "A receipt against that order" },
        { key: "receipt-posted", label: "The receipt is Posted" },
        {
          key: "receipt-has-quantity",
          label: "At least one line received a quantity"
        }
      ],
      capstone: false
    },
    {
      slug: "purchasing-capstone-source-brackets",
      trackSlug: "purchasing",
      title: "Capstone — source 500 brackets",
      brief:
        "You need 500 mounting brackets from a supplier this company has never bought from. Get them on order and into stock. How you do it is up to you.",
      requirements: [
        { key: "supplier-created", label: "A new supplier" },
        {
          key: "quote-active",
          label: "An Active supplier quote from them with a line"
        },
        {
          key: "po-released-for-supplier",
          label: "A released purchase order to that supplier"
        },
        { key: "receipt-posted", label: "A posted receipt against it" }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "suppliers-and-quotes",
      title: "Suppliers and quotes",
      description: "Who you buy from, and how a price becomes a commitment.",
      badgeSlug: "purchasing-sourcing",
      badgeTitle: "Sourcer",
      units: [
        {
          slug: "suppliers",
          title: "Suppliers",
          objective:
            "Say what a supplier record carries and what it shares with a customer.",
          estimatedMinutes: 8,
          docs: [
            docsRef(
              "/docs/reference/suppliers-and-customers",
              "Suppliers & customers"
            )
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "rfq-to-quote",
          title: "From RFQ to quote",
          objective:
            "Shop one item to several suppliers and explain why a quote locks when it leaves Draft.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/guides/rfq-to-po", "From RFQ to PO"),
            docsRef("/docs/reference/supplier-quotes", "Supplier quotes")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        }
      ]
    },
    {
      slug: "purchase-orders",
      title: "Purchase orders",
      description:
        "The order itself, and why its status is not something you type.",
      badgeSlug: "purchasing-orders",
      badgeTitle: "Order writer",
      units: [
        {
          slug: "po-anatomy",
          title: "Anatomy of a purchase order",
          objective:
            "Read a purchase order line and say what has been received, invoiced, and still owed.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/purchase-orders", "Purchase orders")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "po-status-is-computed",
          title: "Status is computed",
          objective:
            "Predict a purchase order's status from its lines, rather than expecting to set it.",
          estimatedMinutes: 10,
          docs: [
            docsRef(
              "/docs/reference/purchase-orders#status",
              "Purchase order status"
            ),
            docsRef("/guides/rfq-to-po", "From RFQ to PO")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "create-and-release-a-po",
          title: "Create and release a PO",
          objective:
            "Raise a two-line purchase order and release it, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/purchase-orders", "Purchase orders")],
          assessment: {
            kind: "challenge",
            challengeSlug: "purchasing-create-release-po"
          }
        }
      ]
    },
    {
      slug: "receiving-and-billing",
      title: "Receiving and billing",
      description: "Goods in, bill in, and the match between them.",
      badgeSlug: "purchasing-receiving",
      badgeTitle: "Three-way matcher",
      units: [
        {
          slug: "receive-goods",
          title: "Receiving goods",
          objective:
            "Say what posting a receipt changes, including when the parts need inspecting.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/guides/receive-and-bill", "Receive, match, bill"),
            docsRef("/docs/reference/receipts", "Receipts")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "three-way-match",
          title: "The three-way match",
          objective:
            "Explain what a posted supplier bill does and does not mean, and where the match happens.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/invoices", "Invoices")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "receive-a-po",
          title: "Receive a purchase order",
          objective:
            "Post a receipt against your own order, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/receipts", "Receipts")],
          assessment: {
            kind: "challenge",
            challengeSlug: "purchasing-receive-po"
          }
        },
        {
          slug: "capstone-source-brackets",
          title: "Capstone — source 500 brackets",
          objective:
            "Run the whole loop yourself: new supplier, quote, order, receipt. No instructions.",
          estimatedMinutes: 40,
          docs: [
            docsRef("/guides/rfq-to-po", "From RFQ to PO"),
            docsRef("/guides/receive-and-bill", "Receive, match, bill")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "purchasing-capstone-source-brackets"
          }
        }
      ]
    }
  ]
};
