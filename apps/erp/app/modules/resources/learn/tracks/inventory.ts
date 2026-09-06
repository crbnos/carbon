/**
 * Inventory track.
 *
 * One file per track so a content change reviews on its own; `curriculum.ts`
 * assembles them and owns the lookup helpers.
 */

import { docsRef } from "../docs";
import type { LearnTrack } from "../types";

export const inventory: LearnTrack = {
  slug: "inventory",
  title: "Inventory",
  description:
    "Where stock lives, how it moves, and how you prove where it came from.",
  audience: "Stores, inventory control",
  status: "live",
  requiredChallengeSlugs: [
    "inventory-adjust-quantity",
    "inventory-transfer-stock",
    "inventory-count-and-post"
  ],
  exam: {
    questionCount: 30,
    timeLimitMinutes: 45,
    topics: [
      { topic: "stock", count: 7 },
      { topic: "movement", count: 6 },
      { topic: "counting", count: 6 },
      { topic: "traceability", count: 6 },
      { topic: "shelf-life", count: 5 }
    ]
  },
  challenges: [
    {
      slug: "inventory-adjust-quantity",
      trackSlug: "inventory",
      title: "Adjust a quantity",
      brief:
        "Stock on the shelf disagrees with stock in Carbon. Post an adjustment so the two match again.",
      requirements: [
        {
          key: "adjustment-posted",
          label: "An inventory adjustment you posted since starting"
        }
      ],
      capstone: false
    },
    {
      slug: "inventory-transfer-stock",
      trackSlug: "inventory",
      title: "Move stock between locations",
      brief:
        "Raise a stock transfer and get it moving — not left sitting in Draft.",
      requirements: [
        {
          key: "transfer-exists",
          label: "A stock transfer you created since starting"
        },
        { key: "transfer-released", label: "It has left Draft" }
      ],
      capstone: false
    },
    {
      slug: "inventory-count-and-post",
      trackSlug: "inventory",
      title: "Capstone — run a stock count",
      brief:
        "Somebody needs to know what is actually on the shelves. Run a count from start to finish, so the ledger reflects the result.",
      requirements: [
        {
          key: "count-exists",
          label: "An inventory count you created since starting"
        },
        { key: "count-has-lines", label: "It has at least one counted line" },
        { key: "count-posted", label: "The count is Posted" }
      ],
      capstone: true
    }
  ],
  modules: [
    {
      slug: "where-stock-lives",
      title: "Where stock lives",
      description:
        "Locations, storage units, and the quantities Carbon tracks against them.",
      badgeSlug: "inventory-stock",
      badgeTitle: "Storekeeper",
      units: [
        {
          slug: "stock-and-storage",
          title: "Stock and storage",
          objective:
            "Say where a quantity is held and which of Carbon's quantity figures answers a given question.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/inventory", "Inventory"),
            docsRef("/docs/reference/storage-rules", "Storage rules")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "picking",
          title: "Picking",
          objective:
            "Explain what a pick reserves and what it does not, and when a pick can fail.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/picking", "Picking")],
          assessment: { kind: "quiz", questionCount: 4 }
        }
      ]
    },
    {
      slug: "moving-stock",
      title: "Moving stock",
      description:
        "Adjustments, transfers, and scrap — every one a ledger entry.",
      badgeSlug: "inventory-movement",
      badgeTitle: "Mover",
      units: [
        {
          slug: "adjustments-and-scrap",
          title: "Adjustments and scrap",
          objective:
            "Say what a positive or negative adjustment writes, and when scrap is the right entry instead.",
          estimatedMinutes: 14,
          docs: [
            docsRef("/docs/reference/inventory", "Inventory"),
            docsRef("/docs/reference/scrap", "Scrap")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "adjust-a-quantity",
          title: "Adjust a quantity",
          objective: "Post a real inventory adjustment, verified in Carbon.",
          estimatedMinutes: 10,
          docs: [docsRef("/docs/reference/inventory", "Inventory")],
          assessment: {
            kind: "challenge",
            challengeSlug: "inventory-adjust-quantity"
          }
        },
        {
          slug: "transfer-stock",
          title: "Transfer stock",
          objective: "Raise and release a stock transfer, verified in Carbon.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/inventory", "Inventory")],
          assessment: {
            kind: "challenge",
            challengeSlug: "inventory-transfer-stock"
          }
        }
      ]
    },
    {
      slug: "proving-it",
      title: "Proving it",
      description:
        "Counting what is really there, and answering where a part came from.",
      badgeSlug: "inventory-assurance",
      badgeTitle: "Counter",
      units: [
        {
          slug: "inventory-counts",
          title: "Counting stock",
          objective:
            "Explain what a blind count hides, and what posting a count writes to the ledger.",
          estimatedMinutes: 14,
          docs: [docsRef("/docs/reference/inventory-count", "Inventory count")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "traceability",
          title: "Traceability",
          objective:
            "Follow a batch or serial from receipt to shipment and say what breaks the chain.",
          estimatedMinutes: 16,
          docs: [docsRef("/docs/reference/traceability", "Traceability")],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "shelf-life",
          title: "Shelf life",
          objective:
            "Say when a shelf-life clock starts and what expiry stops you doing.",
          estimatedMinutes: 12,
          docs: [docsRef("/docs/reference/shelf-life", "Shelf life")],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "capstone-count-and-post",
          title: "Capstone — run a stock count",
          objective:
            "Run a count end to end and post it. No step-by-step instructions.",
          estimatedMinutes: 35,
          docs: [
            docsRef("/docs/reference/inventory-count", "Inventory count"),
            docsRef("/docs/reference/inventory", "Inventory")
          ],
          assessment: {
            kind: "challenge",
            challengeSlug: "inventory-count-and-post"
          }
        }
      ]
    }
  ]
};
