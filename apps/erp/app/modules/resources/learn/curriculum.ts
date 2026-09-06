/**
 * Carbon Learn — the curriculum.
 *
 * Code-shipped on purpose: the content versions with the product, so a
 * certificate can stamp a real `LEARN_CONTENT_VERSION`, and a docs change that
 * invalidates a question shows up in the same review as the docs edit. A
 * company that wants to author its OWN material already has the Training
 * feature (`resources` -> Training); this is Carbon teaching Carbon.
 *
 * Client-safe: titles, objectives, doc links, and assessment shapes only.
 * Question text and answers live in `banks/*.server.ts`; checker logic in
 * `checkers/*.server.ts`.
 */

import { docsRef } from "./docs";
import type {
  LearnChallengeMeta,
  LearnTrack,
  LearnTrackSlug,
  LearnUnit
} from "./types";

const comingSoon = (
  slug: LearnTrackSlug,
  title: string,
  description: string,
  audience: string
): LearnTrack => ({
  slug,
  title,
  description,
  audience,
  modules: [],
  requiredChallengeSlugs: [],
  exam: { questionCount: 30, timeLimitMinutes: 45, topics: [] },
  challenges: [],
  status: "coming-soon"
});

const fundamentals: LearnTrack = {
  slug: "fundamentals",
  title: "Carbon Fundamentals",
  description:
    "How Carbon is put together: items and methods, the company you work in, and who can do what.",
  audience: "Everyone — start here before a role track",
  status: "live",
  requiredChallengeSlugs: ["fundamentals-create-item"],
  exam: {
    questionCount: 20,
    timeLimitMinutes: 30,
    topics: [
      { topic: "overview", count: 4 },
      { topic: "items", count: 5 },
      { topic: "people", count: 4 },
      { topic: "permissions", count: 4 },
      { topic: "glossary", count: 3 }
    ]
  },
  challenges: [
    {
      slug: "fundamentals-create-item",
      trackSlug: "fundamentals",
      title: "Create your first part",
      brief:
        "Create a Part in this company and give it a name you would recognise on a shelf. We will look for a part you created after you started this challenge.",
      requirements: [
        {
          key: "item-exists",
          label: "An item you created since starting this challenge"
        },
        { key: "item-is-part", label: "Its type is Part" },
        { key: "item-named", label: "It has a name" }
      ],
      capstone: false
    }
  ],
  modules: [
    {
      slug: "orientation",
      title: "Orientation",
      description:
        "What Carbon is, what an item is, and how to find your way around.",
      badgeSlug: "fundamentals-orientation",
      badgeTitle: "Oriented",
      units: [
        {
          slug: "what-carbon-is",
          title: "What Carbon is",
          objective:
            "Explain what the ERP and the MES each cover, and which one a given job belongs in.",
          estimatedMinutes: 8,
          docs: [
            docsRef("/docs", "Overview"),
            docsRef("/guides/order", "Start with the order")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "items-and-methods",
          title: "Items and methods",
          objective:
            "Tell an item apart from its method, and predict what changes when a method type changes.",
          estimatedMinutes: 12,
          docs: [
            docsRef("/docs/reference/items", "Items"),
            docsRef("/docs/reference/methods", "Methods & sourcing")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "navigating-carbon",
          title: "Finding your way around",
          objective:
            "Use your account settings, and read Carbon's vocabulary without guessing.",
          estimatedMinutes: 8,
          docs: [
            docsRef("/docs/reference/account", "Your account"),
            docsRef("/docs/glossary", "Glossary")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        }
      ]
    },
    {
      slug: "your-company",
      title: "Your company",
      description:
        "The company record, the people in it, and what they are allowed to do.",
      badgeSlug: "fundamentals-company",
      badgeTitle: "House rules",
      units: [
        {
          slug: "company-and-people",
          title: "The company and its people",
          objective:
            "Say where a company-wide default lives and how an employee record relates to a user.",
          estimatedMinutes: 12,
          docs: [
            docsRef("/docs/reference/company-settings", "Company settings"),
            docsRef("/docs/reference/people", "People")
          ],
          assessment: { kind: "quiz", questionCount: 5 }
        },
        {
          slug: "permissions",
          title: "Permissions",
          objective:
            "Predict whether a given person can perform a given action, and say which lever changes it.",
          estimatedMinutes: 10,
          docs: [
            docsRef("/docs/reference/permissions", "Permissions and access")
          ],
          assessment: { kind: "quiz", questionCount: 4 }
        },
        {
          slug: "create-an-item",
          title: "Create a part",
          objective: "Create a real Part in Carbon and have it verified.",
          estimatedMinutes: 10,
          docs: [docsRef("/docs/reference/items", "Items")],
          assessment: {
            kind: "challenge",
            challengeSlug: "fundamentals-create-item"
          }
        }
      ]
    }
  ]
};

const purchasing: LearnTrack = {
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

export const learnTracks: LearnTrack[] = [
  fundamentals,
  purchasing,
  comingSoon(
    "accounting",
    "Accounting",
    "The ledger behind the paperwork: invoices, payments, period close, and what a job costs.",
    "Controllers, bookkeepers, finance"
  ),
  comingSoon(
    "sales",
    "Sales",
    "Quote to cash: pricing, orders, shipments, and the invoice at the end.",
    "Sales, estimating, customer service"
  ),
  comingSoon(
    "inventory",
    "Inventory",
    "Where stock lives, how it moves, and how you prove where it came from.",
    "Stores, inventory control"
  ),
  comingSoon(
    "production",
    "Production",
    "Jobs, routings, scheduling, and the shop floor reporting back.",
    "Production planners, supervisors"
  ),
  comingSoon(
    "planning",
    "Planning",
    "Demand, forecast, reorder policy, and what MRP does with them.",
    "Planners, buyers"
  ),
  comingSoon(
    "quality",
    "Quality",
    "Issues, inspections, calibration, and the documents an auditor asks for.",
    "Quality managers, inspectors"
  ),
  comingSoon(
    "admin",
    "Administration",
    "Setting Carbon up: company settings, people, custom fields, sequences, and integrations.",
    "System administrators"
  )
];

export function getTrack(slug: string): LearnTrack | undefined {
  return learnTracks.find((track) => track.slug === slug);
}

export function liveTracks(): LearnTrack[] {
  return learnTracks.filter((track) => track.status === "live");
}

export function trackUnits(track: LearnTrack): LearnUnit[] {
  return track.modules.flatMap((module) => module.units);
}

export function trackUnitCount(track: LearnTrack): number {
  return trackUnits(track).length;
}

export function getUnit(
  trackSlug: string,
  unitSlug: string
): LearnUnit | undefined {
  const track = getTrack(trackSlug);
  if (!track) return undefined;
  return trackUnits(track).find((unit) => unit.slug === unitSlug);
}

export function moduleForUnit(trackSlug: string, unitSlug: string) {
  const track = getTrack(trackSlug);
  if (!track) return undefined;
  return track.modules.find((module) =>
    module.units.some((unit) => unit.slug === unitSlug)
  );
}

export function getChallenge(slug: string): LearnChallengeMeta | undefined {
  for (const track of learnTracks) {
    const challenge = track.challenges.find((c) => c.slug === slug);
    if (challenge) return challenge;
  }
  return undefined;
}

/** The unit whose assessment IS this challenge — used to mark progress on a pass. */
export function unitForChallenge(challengeSlug: string) {
  for (const track of learnTracks) {
    for (const module of track.modules) {
      for (const unit of module.units) {
        if (
          unit.assessment.kind === "challenge" &&
          unit.assessment.challengeSlug === challengeSlug
        ) {
          return { track, module, unit };
        }
      }
    }
  }
  return undefined;
}
