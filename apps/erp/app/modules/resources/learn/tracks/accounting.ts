/**
 * Accounting track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const accounting: LearnTrack = {
  slug: "accounting",
  title: "Accounting",
  description:
    "The ledger behind the paperwork: invoices, payments, period close, and what a job costs.",
  audience: "Controllers, bookkeepers, finance",
  status: "live",
  requiredChallengeSlugs: [
    "accounting-post-purchase-invoice",
    "accounting-record-payment",
    "accounting-close-a-period"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "ledger", count: 6 },
      { topic: "invoices", count: 7 },
      { topic: "payments", count: 6 },
      { topic: "period-close", count: 6 },
      { topic: "costing", count: 5 }
    ]
  },
  challenges: [
    {
      slug: "accounting-post-purchase-invoice",
      trackSlug: "accounting",
      title: "Post a supplier bill",
      brief:
        "Enter a supplier bill in this company and post it, so it stops being a draft and starts owing money.",
      requirements: [
        {
          key: "invoice-exists",
          label: "A purchase invoice you created since starting"
        },
        {
          key: "invoice-posted",
          label: "It has been posted — it has left Draft"
        }
      ],
      capstone: false
    },
    {
      slug: "accounting-record-payment",
      trackSlug: "accounting",
      title: "Pay a supplier",
      brief:
        "Record a payment to a supplier and post it. The bill you posted in the last challenge is the obvious one to settle.",
      requirements: [
        {
          key: "payment-exists",
          label: "A payment you created since starting"
        },
        { key: "payment-supplier", label: "It is a payment to a supplier" },
        { key: "payment-posted", label: "It has been posted" }
      ],
      capstone: false
    },
    {
      slug: "accounting-close-a-period",
      trackSlug: "accounting",
      title: "Capstone — close an accounting period",
      brief:
        "Get one accounting period fully closed. Nothing may post into a closed period afterwards, so make sure the period is genuinely finished first.",
      requirements: [
        {
          key: "period-closed",
          label: "An accounting period you closed since starting"
        }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "the-ledger",
      title: "The ledger",
      description:
        "Where the numbers land: the chart of accounts and the dimensions that slice it.",
      badgeSlug: "accounting-ledger",
      badgeTitle: "Ledger reader",
      units: [
        {
          slug: "chart-of-accounts",
          title: "The chart of accounts",
          objective:
            "Say which account a posting lands in, and why an account's class decides how its balance behaves.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/accounting", "Accounting"),
            docsRef("/docs/reference/financial-reports", "Financial reports")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "dimensions",
          title: "Dimensions",
          objective:
            "Explain what a dimension adds to a journal line, and when to reach for one instead of a new account.",
          estimatedMinutes: 10,
          docs: [docsRef("/docs/reference/dimensions", "Dimensions")],
          assessment: { kind: "quiz", questionCount: 4 }
        }
      ]
    },
    {
      slug: "billing-and-cash",
      title: "Billing and cash",
      description: "Bills in, money out, and what posting each one changes.",
      badgeSlug: "accounting-billing",
      badgeTitle: "Bill payer",
      units: [
        {
          slug: "purchase-invoices",
          title: "Supplier bills",
          objective:
            "Read a purchase invoice's status and say what posting it did to the ledger.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/invoices", "Invoices")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "post-a-purchase-invoice",
          title: "Post a supplier bill",
          objective: "Enter and post a real supplier bill, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/invoices", "Invoices")],
          assessment: {
            kind: "challenge",
            challengeSlug: "accounting-post-purchase-invoice"
          }
        },
        {
          slug: "payments",
          title: "Payments",
          objective:
            "Say what applying a payment does to an invoice's balance, and what an unapplied payment leaves behind.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/payments", "Payments")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "record-a-payment",
          title: "Pay a supplier",
          objective: "Record and post a supplier payment, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/payments", "Payments")],
          assessment: {
            kind: "challenge",
            challengeSlug: "accounting-record-payment"
          }
        }
      ]
    },
    {
      slug: "closing-the-books",
      title: "Closing the books",
      description:
        "What a job actually cost, and how a period is frozen once you agree it.",
      badgeSlug: "accounting-close",
      badgeTitle: "Closer",
      units: [
        {
          slug: "job-costing",
          title: "What a job costs",
          objective:
            "Trace a job's cost from material and labour through to the variance the ledger records.",
          estimatedMinutes: 16,
          docs: [
            docsRef("/guides/job-costing", "What a job costs"),
            docsRef("/guides/job-finish-close", "Finishing and closing a job")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "period-close",
          title: "Period close",
          objective:
            "Predict what Open, Locked, and Closed each allow, and what closing a period stops.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/period-close", "Period close")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "capstone-close-a-period",
          title: "Capstone — close a period",
          objective:
            "Close an accounting period yourself. No step-by-step instructions.",
          estimatedMinutes: 30,
          docs: [
            docsRef("/docs/reference/period-close", "Period close"),
            docsRef("/docs/reference/accounting", "Accounting")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "accounting-close-a-period"
          }
        }
      ]
    }
  ]
};
